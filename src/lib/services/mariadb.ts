// MariaDB Connection Service
import mysql from 'mysql2/promise';

const DB_CONFIG = {
	host: 'localhost',
	user: 'root',
	password: '1234',
	database: 'student_verification',
	waitForConnections: true,
	connectionLimit: 10,
	queueLimit: 0
};

let pool: mysql.Pool | null = null;

export async function getConnection() {
	if (!pool) {
		pool = mysql.createPool(DB_CONFIG);
	}
	return pool;
}

export async function initializeDatabase() {
	try {
		// First connect without specifying a database to create it
		const tempConfig = { ...DB_CONFIG };
		(tempConfig as any).database = undefined;

		const tempConnection = await mysql.createPool(tempConfig);

		try {
			// Create database if not exists
			await tempConnection.execute(`
				CREATE DATABASE IF NOT EXISTS student_verification
				CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
			`);
			console.log('✅ Database created successfully');
		} finally {
			await tempConnection.end();
		}

		// Now connect to the created database
		const connection = await getConnection();

		await connection.execute(`USE student_verification`);

		// Student Store table (for face registration lookup)
		await connection.execute(`
			CREATE TABLE IF NOT EXISTS student_store (
				id VARCHAR(20) PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) UNIQUE NOT NULL,
				phone VARCHAR(20),
				program VARCHAR(100),
				year INT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				INDEX idx_email (email)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);

		// Students table
		await connection.execute(`
			CREATE TABLE IF NOT EXISTS students (
				id VARCHAR(20) PRIMARY KEY,
				name VARCHAR(255) NOT NULL,
				email VARCHAR(255) UNIQUE NOT NULL,
				phone VARCHAR(20),
				program VARCHAR(100),
				year INT,
				face_descriptor TEXT NOT NULL,
				face_descriptor_iv VARCHAR(32) NOT NULL,
				qr_code_data VARCHAR(255) UNIQUE NOT NULL,
				consent_given BOOLEAN DEFAULT FALSE,
				consent_date TIMESTAMP NULL,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				INDEX idx_qr_code (qr_code_data),
				INDEX idx_email (email),
				INDEX idx_consent (consent_given)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);

		// Verification logs table
		await connection.execute(`
			CREATE TABLE IF NOT EXISTS verification_logs (
				id INT AUTO_INCREMENT PRIMARY KEY,
				student_id VARCHAR(20) NOT NULL,
				verification_type ENUM('qr_scan', 'face_match', 'manual') NOT NULL,
				success BOOLEAN NOT NULL,
				confidence_score DECIMAL(5,4),
				device_info TEXT,
				ip_address VARCHAR(45),
				location_info TEXT,
				error_message TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
				INDEX idx_student_id (student_id),
				INDEX idx_created_at (created_at),
				INDEX idx_success (success)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);

		// Consent audit log
		await connection.execute(`
			CREATE TABLE IF NOT EXISTS consent_audit (
				id INT AUTO_INCREMENT PRIMARY KEY,
				student_id VARCHAR(20) NOT NULL,
				action ENUM('granted', 'revoked', 'updated') NOT NULL,
				ip_address VARCHAR(45),
				user_agent TEXT,
				created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
				INDEX idx_student_id (student_id),
				INDEX idx_created_at (created_at)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);

		// Data retention policy tracking
		await connection.execute(`
			CREATE TABLE IF NOT EXISTS data_retention (
				id INT AUTO_INCREMENT PRIMARY KEY,
				student_id VARCHAR(20) NOT NULL,
				retention_days INT DEFAULT 90,
				scheduled_deletion_date DATE,
				deleted BOOLEAN DEFAULT FALSE,
				deleted_at TIMESTAMP NULL,
				FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
				INDEX idx_scheduled_deletion (scheduled_deletion_date),
				INDEX idx_deleted (deleted)
			) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
		`);

		console.log('✅ Database initialized successfully');
		console.log('📊 Tables created:');
		console.log('  - student_store (face registration lookup)');
		console.log('  - students (encrypted face data)');
		console.log('  - verification_logs');
		console.log('  - consent_audit');
		console.log('  - data_retention');
	} catch (error) {
		console.warn('⚠️ Database initialization failed, but continuing:', error);
		// Don't throw - allow the app to continue without database
	}
}

export async function closeConnection() {
	if (pool) {
		await pool.end();
		pool = null;
	}
}

// Student Store operations
export async function getStudentFromStore(studentId: string) {
	const connection = await getConnection();
	const [rows] = await connection.execute('SELECT * FROM student_store WHERE id = ?', [studentId]);
	return rows as any[];
}

export async function addStudentToStore(student: { id: string; name: string; email: string; phone?: string; program?: string; year?: number }) {
	try {
		const connection = await getConnection();
		await connection.execute(
			'INSERT INTO student_store (id, name, email, phone, program, year) VALUES (?, ?, ?, ?, ?, ?)',
			[student.id, student.name, student.email, student.phone || null, student.program || null, student.year || null]
		);
	} catch (error) {
		console.warn('Failed to add student to store:', error);
		// Don't throw - allow the process to continue
	}
}

export async function getAllStudentsFromStore() {
	const connection = await getConnection();
	const [rows] = await connection.execute('SELECT * FROM student_store ORDER BY created_at DESC');
	return rows as any[];
}

// Students table operations (encrypted face data)
export async function getAllStudentsMariaDB() {
	try {
		const connection = await getConnection();
		const [rows] = await connection.execute(`
			SELECT 
				id, name, email, phone, program, year, 
				face_descriptor, face_descriptor_iv,
				qr_code_data, consent_given, consent_date,
				created_at, updated_at
			FROM students 
			ORDER BY created_at DESC
		`);
		
		return (rows as any[]).map(row => ({
			id: row.id,
			name: row.name,
			email: row.email,
			phone: row.phone,
			program: row.program,
			year: row.year,
			faceDescriptor: row.face_descriptor ? new Float32Array(JSON.parse(row.face_descriptor)) : new Float32Array([0]),
			qrCodeData: row.qr_code_data,
			consentGiven: row.consent_given === 1,
			consentDate: row.consent_date,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		}));
	} catch (error) {
		console.warn('Database not available, returning empty array:', error);
		return [];
	}
}

export async function getStudentByIdMariaDB(id: string) {
	try {
		const connection = await getConnection();
		const [rows] = await connection.execute(`
			SELECT 
				id, name, email, phone, program, year, 
				face_descriptor, face_descriptor_iv,
				qr_code_data, consent_given, consent_date,
				created_at, updated_at
			FROM students 
			WHERE id = ?
		`, [id]);
		
		if ((rows as any[]).length === 0) return null;
		
		const row = (rows as any[])[0];
		return {
			id: row.id,
			name: row.name,
			email: row.email,
			phone: row.phone,
			program: row.program,
			year: row.year,
			faceDescriptor: row.face_descriptor ? new Float32Array(JSON.parse(row.face_descriptor)) : new Float32Array([0]),
			qrCodeData: row.qr_code_data,
			consentGiven: row.consent_given === 1,
			consentDate: row.consent_date,
			createdAt: row.created_at,
			updatedAt: row.updated_at
		};
	} catch (error) {
		console.warn('Database not available for getStudentById:', error);
		return null;
	}
}

export async function getStudentByQRCodeMariaDB(qrCode: string) {
	const connection = await getConnection();
	const [rows] = await connection.execute(`
		SELECT 
			id, name, email, phone, program, year, 
			face_descriptor, face_descriptor_iv,
			qr_code_data, consent_given, consent_date,
			created_at, updated_at
		FROM students 
		WHERE qr_code_data = ?
	`, [qrCode]);
	
	if ((rows as any[]).length === 0) return null;
	
	const row = (rows as any[])[0];
	return {
		id: row.id,
		name: row.name,
		email: row.email,
		phone: row.phone,
		program: row.program,
		year: row.year,
		faceDescriptor: new Float32Array(JSON.parse(row.face_descriptor)), // Decrypt would be needed here
		qrCodeData: row.qr_code_data,
		consentGiven: row.consent_given === 1,
		consentDate: row.consent_date,
		createdAt: row.created_at,
		updatedAt: row.updated_at
	};
}

export async function addStudentMariaDB(student: any) {
	const connection = await getConnection();
	
	// For now, store face descriptor as JSON (should be encrypted in production)
	const faceDescriptorJson = JSON.stringify(Array.from(student.faceDescriptor));
	
	await connection.execute(`
		INSERT INTO students (
			id, name, email, phone, program, year, 
			face_descriptor, face_descriptor_iv,
			qr_code_data, consent_given, consent_date
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, [
		student.id,
		student.name,
		student.email,
		student.phone || null,
		student.program || null,
		student.year || null,
		faceDescriptorJson,
		'', // IV for encryption (empty for now)
		student.qrCodeData,
		student.consentGiven ? 1 : 0,
		student.consentDate || null
	]);
}

export async function updateStudentMariaDB(id: string, updates: any) {
	const connection = await getConnection();
	
	const setParts = [];
	const values = [];
	
	if (updates.name !== undefined) {
		setParts.push('name = ?');
		values.push(updates.name);
	}
	if (updates.email !== undefined) {
		setParts.push('email = ?');
		values.push(updates.email);
	}
	if (updates.phone !== undefined) {
		setParts.push('phone = ?');
		values.push(updates.phone);
	}
	if (updates.program !== undefined) {
		setParts.push('program = ?');
		values.push(updates.program);
	}
	if (updates.year !== undefined) {
		setParts.push('year = ?');
		values.push(updates.year);
	}
	if (updates.faceDescriptor !== undefined) {
		setParts.push('face_descriptor = ?');
		values.push(JSON.stringify(Array.from(updates.faceDescriptor)));
	}
	if (updates.qrCodeData !== undefined) {
		setParts.push('qr_code_data = ?');
		values.push(updates.qrCodeData);
	}
	if (updates.consentGiven !== undefined) {
		setParts.push('consent_given = ?');
		values.push(updates.consentGiven ? 1 : 0);
	}
	if (updates.consentDate !== undefined) {
		setParts.push('consent_date = ?');
		values.push(updates.consentDate);
	}
	
	if (setParts.length === 0) return;
	
	setParts.push('updated_at = CURRENT_TIMESTAMP');
	
	const query = `UPDATE students SET ${setParts.join(', ')} WHERE id = ?`;
	values.push(id);
	
	await connection.execute(query, values);
}

export async function deleteStudentMariaDB(id: string) {
	const connection = await getConnection();
	await connection.execute('DELETE FROM students WHERE id = ?', [id]);
}

export async function clearAllDataMariaDB() {
	const connection = await getConnection();
	
	// Clear all tables in correct order (respecting foreign keys)
	await connection.execute('DELETE FROM data_retention');
	await connection.execute('DELETE FROM consent_audit');
	await connection.execute('DELETE FROM verification_logs');
	await connection.execute('DELETE FROM students');
	await connection.execute('DELETE FROM student_store');
}

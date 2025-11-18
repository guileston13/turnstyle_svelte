// Database initialization script
import { initializeDatabase, closeConnection } from './src/lib/services/mariadb';

async function init() {
	try {
		console.log('🚀 Initializing database...');
		await initializeDatabase();
		console.log('✅ Database initialized successfully!');
		console.log('📊 Tables created:');
		console.log('  - students');
		console.log('  - verification_logs');
		console.log('  - consent_audit');
		console.log('  - data_retention');
		await closeConnection();
		process.exit(0);
	} catch (error) {
		console.error('❌ Failed to initialize database:', error);
		process.exit(1);
	}
}

init();

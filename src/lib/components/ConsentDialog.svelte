<!-- GDPR Consent Dialog Component -->
<script lang="ts">
	let { open = $bindable(false), onAccept, onDecline }: {
		open?: boolean;
		onAccept: () => void;
		onDecline: () => void
	} = $props();

	function handleAccept() {
		onAccept();
		open = false;
	}

	function handleDecline() {
		onDecline();
		open = false;
	}
</script>

{#if open}
	<div class="consent-overlay">
		<div class="consent-dialog">
			<h2 class="dialog-title">DATA CONSENT REQUIRED</h2>

			<div class="dialog-content">
				<p class="consent-text">
					<strong>FACE VERIFICATION SYSTEM</strong>
				</p>

				<p class="consent-text">
					We need your consent to collect and process your facial biometric data for identity
					verification purposes.
				</p>

				<div class="consent-details">
					<h3 class="details-title">WHAT WE COLLECT:</h3>
					<ul class="details-list">
						<li>Facial recognition descriptors (128 numeric values)</li>
						<li>Student ID and basic information</li>
						<li>Verification timestamps and results</li>
					</ul>

					<h3 class="details-title">HOW WE PROTECT YOUR DATA:</h3>
					<ul class="details-list">
						<li>AES-256-GCM encryption for all biometric data</li>
						<li>Local and encrypted database storage</li>
						<li>90-day automatic data retention policy</li>
						<li>Right to erasure at any time</li>
					</ul>

					<h3 class="details-title">YOUR RIGHTS:</h3>
					<ul class="details-list">
						<li>Access your data at any time</li>
						<li>Request deletion of your data</li>
						<li>Withdraw consent at any time</li>
						<li>Export your data</li>
					</ul>
				</div>

				<p class="consent-text">
					By clicking "I ACCEPT", you consent to the collection and processing of your biometric
					data in accordance with GDPR regulations.
				</p>
			</div>

			<div class="dialog-actions">
				<button class="btn-decline" onclick={handleDecline}>DECLINE</button>
				<button class="btn-accept" onclick={handleAccept}>I ACCEPT</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.consent-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.8);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 16px;
	}

	.consent-dialog {
		background: #ffffff;
		border: 2px solid #383838;
		max-width: 600px;
		width: 100%;
		max-height: 90vh;
		overflow-y: auto;
		animation: slideIn 0.3s ease;
	}

	@keyframes slideIn {
		from {
			transform: translateY(-50px);
			opacity: 0;
		}
		to {
			transform: translateY(0);
			opacity: 1;
		}
	}

	.dialog-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 18px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.6px;
		color: #383838;
		padding: 16px;
		margin: 0;
		background: #ffe100;
		border-bottom: 2px solid #383838;
	}

	.dialog-content {
		padding: 32px;
	}

	.consent-text {
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		line-height: 1.6;
		color: #383838;
		margin: 0 0 16px 0;
	}

	.consent-details {
		margin: 24px 0;
		padding: 16px;
		background: #f4efea;
		border: 2px solid #383838;
	}

	.details-title {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		color: #383838;
		margin: 16px 0 8px 0;
	}

	.details-title:first-child {
		margin-top: 0;
	}

	.details-list {
		font-family: 'JetBrains Mono', monospace;
		font-size: 12px;
		line-height: 1.6;
		color: #383838;
		margin: 0;
		padding-left: 24px;
	}

	.details-list li {
		margin: 4px 0;
	}

	.dialog-actions {
		display: flex;
		gap: 16px;
		padding: 16px;
		border-top: 2px solid #383838;
		background: #f4efea;
	}

	.btn-accept,
	.btn-decline {
		flex: 1;
		padding: 16px 32px;
		font-family: 'JetBrains Mono', monospace;
		font-size: 14px;
		font-weight: bold;
		text-transform: uppercase;
		letter-spacing: 0.5px;
		border: 2px solid #383838;
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.btn-accept {
		background: #34c759;
		color: #ffffff;
	}

	.btn-accept:hover {
		background: #28a745;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
	}

	.btn-decline {
		background: transparent;
		color: #ff3b30;
		border-color: #ff3b30;
	}

	.btn-decline:hover {
		background: #ff3b30;
		color: #ffffff;
		transform: translateY(-2px);
		box-shadow: 0 4px 8px rgba(255, 59, 48, 0.3);
	}
</style>

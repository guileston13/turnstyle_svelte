#!/usr/bin/env python3
"""
Raspberry Pi 5 Turnstile Controller
====================================
Connects to SvelteKit SSE endpoint and controls solenoid via GPIO

Hardware Setup:
- GPIO 17: Solenoid relay (unlock turnstile)
- GPIO 27: LED indicator (optional status LED)
- Yuriot ScanCode Box: USB QR/Barcode scanner (auto-detected)

Requirements:
- pip3 install requests lgpio
- Run with sudo: sudo python3 turnstile-controller.py
- Connect Yuriot ScanCode Box scanner before starting
- Test scanner: sudo python3 turnstile-controller.py test
"""

import time
import json
import requests
import lgpio
import subprocess
import threading
import urllib3
import glob
import os

# Disable SSL warnings for self-signed certificates
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ---------------- CONFIGURATION ----------------
SOLENOID_PIN = 17       # GPIO pin for solenoid relay
LED_PIN = 27            # GPIO pin for status LED (optional)
PORT = "5173"           # SvelteKit dev port (use 4173 for preview)
UNLOCK_DURATION = 3     # Seconds to keep solenoid energized
RECONNECT_DELAY = 5     # Seconds before retrying SSE connection
CONNECT_TIMEOUT = 5     # Seconds to wait when opening a new connection
READ_TIMEOUT = 65       # Seconds to wait for SSE data before reconnecting
TROUBLESHOOT_COOLDOWN = 30  # Limit repeated troubleshooting logs
# 🔧 CHANGE THIS IP TO YOUR DEVICE'S IP ADDRESS
# Find your IP: ifconfig (Linux) or ipconfig (Windows)
SERVER_IP = "172.27.44.225"  # ← CHANGE THIS LINE

WEB_URL = f"https://{SERVER_IP}:{PORT}/"
SSE_URL = f"https://{SERVER_IP}:{PORT}/api/turnstile"
DEVICE_NAME = "device1"  # Default device name
# ------------------------------------------------

# ---------------- GLOBAL VARIABLES --------------
chip = None
sse_thread = None
running = False
last_sse_activity = 0
last_troubleshoot_time = 0
# ------------------------------------------------


def wait_for_scanner():
    """Wait for Yuriot ScanCode Box scanner to be connected"""
    print("🔍 Looking for Yuriot ScanCode Box scanner...")

    max_attempts = 30  # Wait up to 30 seconds
    attempt = 0

    while attempt < max_attempts:
        try:
            # Check if scanner is connected via lsusb
            result = subprocess.run(['lsusb'], capture_output=True, text=True, timeout=5)
            print(f"🔍 lsusb output: {result.stdout[:200]}...")  # Debug: show first 200 chars

            # Check for various possible names
            scanner_names = ['Yuriot', 'YuRiot', 'ScanCode Box', 'Scan Box', 'Barcode', 'Scanner']
            detected = False
            for name in scanner_names:
                if name.lower() in result.stdout.lower():
                    print(f"✅ Scanner detected via lsusb: {name}")
                    detected = True
                    break

            if detected:
                return True

            # Check recent kernel messages for USB connections
            dmesg_result = subprocess.run(['dmesg', '--time-format=iso', '--since=-30seconds'],
                                        capture_output=True, text=True, timeout=5)
            print(f"🔍 Recent dmesg: {dmesg_result.stdout[-200:]}...")  # Debug: show last 200 chars

            for name in scanner_names:
                if name.lower() in dmesg_result.stdout.lower():
                    print(f"✅ Scanner detected in logs: {name}")
                    return True

            # Check HID devices and their details
            hid_devices = glob.glob('/dev/hidraw*')
            print(f"🔍 Found HID devices: {hid_devices}")

            if hid_devices:
                for device in hid_devices:
                    try:
                        # Check device name
                        device_name_path = f"/sys/class/hidraw/{os.path.basename(device)}/device/uevent"
                        if os.path.exists(device_name_path):
                            with open(device_name_path, 'r') as f:
                                uevent_content = f.read()
                                print(f"🔍 HID device {device}: {uevent_content[:100]}...")

                                for name in scanner_names:
                                    if name.lower() in uevent_content.lower():
                                        print(f"✅ Scanner detected via HID: {name}")
                                        return True

                        # Check manufacturer and product
                        manufacturer_path = f"/sys/class/hidraw/{os.path.basename(device)}/device/manufacturer"
                        product_path = f"/sys/class/hidraw/{os.path.basename(device)}/device/product"

                        manufacturer = ""
                        product = ""

                        if os.path.exists(manufacturer_path):
                            with open(manufacturer_path, 'r') as f:
                                manufacturer = f.read().strip()
                        if os.path.exists(product_path):
                            with open(product_path, 'r') as f:
                                product = f.read().strip()

                        print(f"🔍 HID {device} - Manufacturer: '{manufacturer}', Product: '{product}'")

                        # Check if this looks like a scanner
                        scanner_keywords = ['yuriot', 'scan', 'barcode', 'scanner', 'reader']
                        if any(keyword in (manufacturer + product).lower() for keyword in scanner_keywords):
                            print(f"✅ Scanner detected by keywords: {manufacturer} {product}")
                            return True

                    except Exception as e:
                        print(f"⚠️ Error checking HID device {device}: {e}")
                        continue

        except Exception as e:
            print(f"⚠️ Error checking for scanner: {e}")

        attempt += 1
        if attempt < max_attempts:
            print(f"⏳ Waiting for scanner... ({attempt}/{max_attempts})")
            time.sleep(1)

    print("❌ Yuriot ScanCode Box scanner not found within timeout")
    print("💡 Make sure the scanner is connected and powered on")
    print("💡 Try running: lsusb | grep -i scan")
    print("💡 Or check: ls -la /dev/hidraw*")
    return False


def gpio_setup():
    """Initialize GPIO pins"""
    global chip

    chip = lgpio.gpiochip_open(0)
    lgpio.gpio_claim_output(chip, SOLENOID_PIN)
    lgpio.gpio_claim_output(chip, LED_PIN)
    lgpio.gpio_write(chip, SOLENOID_PIN, 0)  # Start locked
    lgpio.gpio_write(chip, LED_PIN, 0)       # LED off
    print("✅ GPIO initialized")


def gpio_cleanup():
    """Clean up GPIO on exit"""
    global chip
    if chip:
        lgpio.gpio_write(chip, SOLENOID_PIN, 0)
        lgpio.gpio_write(chip, LED_PIN, 0)
        lgpio.gpiochip_close(chip)
        print("✅ GPIO cleaned up")


def unlock_turnstile(student_name=None):
    """Energize solenoid to unlock turnstile"""
    print(f"🔓 UNLOCKING TURNSTILE" + (f" for {student_name}" if student_name else ""))
    lgpio.gpio_write(chip, SOLENOID_PIN, 1)
    lgpio.gpio_write(chip, LED_PIN, 1)  # LED on
    time.sleep(UNLOCK_DURATION)
    lgpio.gpio_write(chip, SOLENOID_PIN, 0)
    lgpio.gpio_write(chip, LED_PIN, 0)
    print("🔒 Turnstile locked")


def lock_turnstile():
    """De-energize solenoid to lock turnstile"""
    lgpio.gpio_write(chip, SOLENOID_PIN, 0)
    lgpio.gpio_write(chip, LED_PIN, 0)
    print("🔒 Turnstile locked")


def print_connection_troubleshooting(reason, error=None):
    """Print actionable troubleshooting steps when the Pi cannot talk to the web app"""
    global last_troubleshoot_time

    now = time.time()
    if now - last_troubleshoot_time < TROUBLESHOOT_COOLDOWN:
        return

    last_troubleshoot_time = now

    print(f"Communication troubleshooting: {reason}")

    try:
        with requests.get(WEB_URL, verify=False, timeout=CONNECT_TIMEOUT) as response:
            print(f"Main web app check: HTTP {response.status_code} from {WEB_URL}")
            if response.status_code != 200:
                print("The Pi reached the server, but the web app did not respond normally.")
                print("Check the SvelteKit terminal for startup errors or crashed routes.")
            else:
                print("The Pi can reach the main web app, so check the SSE endpoint and server logs.")
    except requests.exceptions.RequestException as web_error:
        print(f"Main web app check failed: {web_error}")
        print("The Pi could not reach the main web app from the network.")

    print(f"Configured SERVER_IP: {SERVER_IP}")
    print(f"Browser URL: {WEB_URL}")
    print(f"SSE URL: {SSE_URL}")
    print("Make sure the main web app is running before starting this script.")
    print("Make sure the host computer IP still matches SERVER_IP.")
    print(f"Make sure port {PORT} is allowed through the host firewall.")
    print("Make sure the Raspberry Pi and the host computer are on the same network.")
    print("If the web app uses HTTPS, keep the https:// URL here. If the IP changed, update SERVER_IP.")

    if error:
        print(f"Last connection error: {error}")


def sse_listener():
    """Listen to SSE events from SvelteKit server"""
    global running, last_sse_activity
    attempt = 0

    print(f"📡 Connecting to SSE: {SSE_URL}")

    while running:
        attempt += 1
        try:
            # Use requests with stream=True for SSE
            print(f"SSE connection attempt #{attempt}")
            with requests.get(
                SSE_URL,
                stream=True,
                verify=False,
                timeout=(CONNECT_TIMEOUT, READ_TIMEOUT),
                headers={'Accept': 'text/event-stream', 'Cache-Control': 'no-cache'}
            ) as response:
                if response.status_code != 200:
                    print(f"❌ SSE endpoint returned HTTP {response.status_code}")
                    print_connection_troubleshooting(
                        f"SSE endpoint responded with HTTP {response.status_code}"
                    )
                    time.sleep(RECONNECT_DELAY)
                    continue

                content_type = response.headers.get('Content-Type', '')
                if 'text/event-stream' not in content_type:
                    print(f"⚠️ Unexpected SSE content type: {content_type}")

                print("✅ SSE stream opened, waiting for events...")
                last_sse_activity = time.time()
                received_stream_data = False

                for line in response.iter_lines():
                    if not running:
                        break

                    last_sse_activity = time.time()

                    if line:
                        received_stream_data = True
                        line_str = line.decode('utf-8')

                        # Skip heartbeat comments
                        if line_str.startswith(':'):
                            continue

                        # Parse SSE data
                        if line_str.startswith('data:'):
                            data_str = line_str[5:].strip()
                            try:
                                data = json.loads(data_str)
                                handle_sse_event(data)
                            except json.JSONDecodeError:
                                print(f"⚠️ Invalid JSON: {data_str}")

                if running:
                    seconds_since_activity = max(0, int(time.time() - last_sse_activity))
                    if received_stream_data:
                        print(f"⚠️ SSE stream closed after {seconds_since_activity} seconds without data, reconnecting in {RECONNECT_DELAY} seconds...")
                    else:
                        print(f"⚠️ SSE stream closed before any data arrived, reconnecting in {RECONNECT_DELAY} seconds...")
                        print_connection_troubleshooting("SSE stream closed before the Pi received any event")
                    time.sleep(RECONNECT_DELAY)

        except requests.exceptions.Timeout:
            seconds_since_activity = max(0, int(time.time() - last_sse_activity)) if last_sse_activity else READ_TIMEOUT
            print(f"⏱️ SSE connection timeout after about {seconds_since_activity} seconds without data, reconnecting...")
            print_connection_troubleshooting(
                f"No SSE data received for more than {READ_TIMEOUT} seconds"
            )
            time.sleep(RECONNECT_DELAY)
        except requests.exceptions.SSLError as e:
            print(f"❌ SSL error: {e}")
            print_connection_troubleshooting("HTTPS handshake failed while connecting to the web app", e)
            print(f"🔄 Reconnecting in {RECONNECT_DELAY} seconds...")
            time.sleep(RECONNECT_DELAY)
        except requests.exceptions.ConnectionError as e:
            print(f"❌ Connection error: {e}")
            print_connection_troubleshooting("The Raspberry Pi could not reach the SSE server", e)
            print(f"🔄 Reconnecting in {RECONNECT_DELAY} seconds...")
            time.sleep(RECONNECT_DELAY)
        except Exception as e:
            print(f"❌ SSE error: {e}")
            print_connection_troubleshooting("Unexpected SSE listener error", e)
            time.sleep(RECONNECT_DELAY)


def handle_sse_event(data):
    """Handle incoming SSE events"""
    event = data.get('event')
    device = data.get('device', 'all')
    my_device = DEVICE_NAME

    # Only react if message is for this device or for "all"
    if device != my_device and device != 'all':
        print(f"📡 Ignoring event for {device} (I am {my_device})")
        return

    print(f"📨 Event received: {event} | Device: {device}")

    if event == 'connected':
        print("✅ SSE Connected to server!")
        lgpio.gpio_write(chip, LED_PIN, 1)
        time.sleep(0.2)
        lgpio.gpio_write(chip, LED_PIN, 0)

    elif event == 'unlock' or event == 'verified':
        student_name = data.get('studentName')
        student_id = data.get('studentId')
        print(f"✅ VERIFIED: {student_name} ({student_id})")
        # Run unlock in separate thread to not block SSE listener
        threading.Thread(target=unlock_turnstile, args=(student_name,)).start()

    elif event == 'lock':
        lock_turnstile()

    elif event == 'failed':
        print("❌ Verification failed")
        # Blink LED to indicate failure
        for _ in range(3):
            lgpio.gpio_write(chip, LED_PIN, 1)
            time.sleep(0.1)
            lgpio.gpio_write(chip, LED_PIN, 0)
            time.sleep(0.1)


def start_program():
    """Start the turnstile controller"""
    global running, sse_thread

    print(f"📍 WEB_URL: {WEB_URL}")
    print(f"📡 SSE_URL: {SSE_URL}")
    print(f"🏷️ DEVICE_NAME: {DEVICE_NAME}")

    # Set HID permissions first
    print("🔧 Setting HID device permissions...")
    try:
        subprocess.run('sudo chmod 666 /dev/hidraw*', shell=True, check=False)
        print("✅ HID device permissions set")
    except Exception as e:
        print(f"⚠️ Failed to set HID permissions: {e}")

    # Initialize GPIO
    gpio_setup()

    # Now wait for Yuriot ScanCode Box scanner to connect
    if not wait_for_scanner():
        print("⚠️ Continuing without scanner detection...")

    # Open Chromium in kiosk mode with auto-permissions
    print("🌐 Launching Chromium kiosk with auto-permissions...")
    subprocess.Popen([
        "/usr/bin/chromium",
        "--kiosk",
        "--noerrdialogs",
        "--disable-infobars",
        "--incognito",
        "--ignore-certificate-errors",
        # Auto-grant camera and microphone permissions
        "--use-fake-ui-for-media-stream",
        # Enable WebHID API
        "--enable-features=WebHID",
        # Disable permission prompts
        "--disable-features=TranslateUI",
        "--disable-popup-blocking",
        "--autoplay-policy=no-user-gesture-required",
        # Performance optimizations for Raspberry Pi
        "--disable-gpu",
        "--disable-software-rasterizer",
        "--disable-dev-shm-usage",
        # Allow insecure localhost for self-signed certs
        "--allow-insecure-localhost",
        WEB_URL
    ])

    # Start SSE listener
    running = True
    sse_thread = threading.Thread(target=sse_listener, daemon=True)
    sse_thread.start()

    print("🚀 Turnstile controller started!")
    print("📡 Listening for SSE events...")
    print(f"🔄 Auto-reconnect enabled if the Pi and web app stop communicating (retry every {RECONNECT_DELAY} seconds)")
    print("💡 Make sure to run with sudo for HID device access: sudo python3 turnstile-controller.py")
    print("🔍 Yuriot ScanCode Box scanner should be connected and detected")
    print("Press Ctrl+C to exit")

    # Keep main thread alive
    try:
        while running:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n👋 Shutting down...")
        running = False
    finally:
        gpio_cleanup()


def test_scanner_detection():
    """Test function to debug scanner detection"""
    print("🧪 Testing scanner detection...")

    print("\n1. Checking lsusb:")
    try:
        result = subprocess.run(['lsusb'], capture_output=True, text=True, timeout=5)
        print(result.stdout)
    except Exception as e:
        print(f"Error: {e}")

    print("\n2. Checking HID devices:")
    try:
        hid_devices = glob.glob('/dev/hidraw*')
        print(f"HID devices: {hid_devices}")

        for device in hid_devices:
            try:
                manufacturer_path = f"/sys/class/hidraw/{os.path.basename(device)}/device/manufacturer"
                product_path = f"/sys/class/hidraw/{os.path.basename(device)}/device/product"

                manufacturer = "Unknown"
                product = "Unknown"

                if os.path.exists(manufacturer_path):
                    with open(manufacturer_path, 'r') as f:
                        manufacturer = f.read().strip()
                if os.path.exists(product_path):
                    with open(product_path, 'r') as f:
                        product = f.read().strip()

                print(f"  {device}: {manufacturer} - {product}")
            except Exception as e:
                print(f"  {device}: Error reading info - {e}")
    except Exception as e:
        print(f"Error checking HID devices: {e}")

    print("\n3. Checking recent dmesg:")
    try:
        result = subprocess.run(['dmesg', '--time-format=iso', '--since=-60seconds'],
                              capture_output=True, text=True, timeout=5)
        # Filter for USB-related messages
        usb_lines = [line for line in result.stdout.split('\n') if 'usb' in line.lower() or 'hid' in line.lower()]
        for line in usb_lines[-10:]:  # Show last 10 USB/HID related lines
            print(f"  {line}")
    except Exception as e:
        print(f"Error checking dmesg: {e}")


# Allow running test function
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "test":
        test_scanner_detection()
    else:
        start_program()

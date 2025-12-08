#!/bin/bash
# Setup script for Raspberry Pi HID permissions
# Run this once: sudo ./setup-hid-permissions.sh

echo "🔧 Setting up HID device permissions..."

# Create udev rule for automatic permissions
cat > /etc/udev/rules.d/99-hidraw.rules << 'EOF'
SUBSYSTEM=="hidraw", MODE="0666"
KERNEL=="hidraw*", MODE="0666"
EOF

# Reload udev rules
udevadm control --reload-rules
udevadm trigger

echo "✅ HID permissions configured!"
echo "🔄 Unplug and replug your barcode scanner"
echo "🚀 You can now run the controller without sudo: python3 turnstile-controller.py"
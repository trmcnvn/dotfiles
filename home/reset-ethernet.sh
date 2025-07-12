#!/bin/bash

# Reset Intel I225-V ethernet controller

set -e

DEVICE_PATH="/sys/bus/pci/devices/0000:0a:00.0"
INTERFACE="eno1"

echo "Resetting Intel I225-V ethernet controller..."

# Check if device exists
if [ ! -d "$DEVICE_PATH" ]; then
    echo "Error: Device not found at $DEVICE_PATH"
    exit 1
fi

# Remove the device
echo "Removing PCIe device..."
echo 1 > "$DEVICE_PATH/remove"

# Wait a moment
sleep 2

# Rescan PCI bus
echo "Rescanning PCI bus..."
echo 1 > /sys/bus/pci/rescan

# Wait for device to come back
sleep 3

# Check if interface is back
if ip link show "$INTERFACE" &>/dev/null; then
    echo "Success: $INTERFACE is back online"
    ip link show "$INTERFACE"
else
    echo "Warning: $INTERFACE not found, but device may still be initializing"
fi

echo "Reset complete."

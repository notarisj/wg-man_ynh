#!/bin/bash
# Default VPN monitor stub installed by wg-man.
# Replace this file with your actual monitoring script, or edit it in place.
#
# CONTRACT:
#   - Exit 0 on success, non-zero on failure
#   - Do NOT print the word CRITICAL to stderr (that signals a hard failure to the app)
#   - Print a short status line to stdout (shown in the WG Manager Logs page)
#
# This stub simply confirms that the configured static interface is up.

STATIC_IFACE="${WG_STATIC_INTERFACE:-wg0}"

if ip link show "$STATIC_IFACE" &>/dev/null; then
    echo "$(date '+%Y-%m-%d %H:%M:%S') [vpn-monitor] Interface $STATIC_IFACE is UP"
    exit 0
else
    echo "$(date '+%Y-%m-%d %H:%M:%S') [vpn-monitor] Interface $STATIC_IFACE is DOWN" >&2
    exit 1
fi

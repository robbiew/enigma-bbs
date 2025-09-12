#!/bin/bash
# Debug: Log what we receive
echo "Args received: $*" >> ~/enigma-bbs/logs/sabacc_debug.log
echo "Arg 1: $1" >> ~/enigma-bbs/logs/sabacc_debug.log
echo "Working dir: $(pwd)" >> ~/enigma-bbs/logs/sabacc_debug.log

# Set working directory
cd /home/bbs/enigma-bbs/doors/sabacc/

# Check if argument was passed
if [ -z "$1" ]; then
    echo "No path argument received, using current directory" >> ~/enigma-bbs/logs/sabacc_debug.log
    ./sabacc -path ./
else
    echo "Using path: $1" >> ~/enigma-bbs/logs/sabacc_debug.log
    ./sabacc -path "$1"
fi
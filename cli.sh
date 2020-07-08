#!/bin/bash

if [ "$1" == "login" ] || [ "$1" == "-l" ]; then
    node dist/login.js "$@"
elif [ "$1" == "clean" ] || [ "$1" == "-c" ]; then
    npm prune --production
else
    echo "Invalid command."
fi
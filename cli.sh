#!/bin/bash

if [ "$1" == "login" ] || [ "$1" == "-l" ]; then
    if [[ $(npm list puppeteer) = *puppeteer* ]]; then
        node dist/login.js
    else
        read -p "The latest version of Chromium browser will be downloaded. Would you like to continue? (y/N): " convar
        if [ "$convar" == "y" ] || [ "$convar" == "Y" ]; then
            npm install puppeteer puppeteer-extra puppeteer-extra-plugin-stealth@2.4.5 && node dist/login.js
        else
            echo "Exiting..."
        fi
    fi
elif [ "$1" == "clean" ] || [ "$1" == "-c" ]; then
    npm prune --production
else
    echo "Invalid command."
fi
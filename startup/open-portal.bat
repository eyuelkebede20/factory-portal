@echo off
setlocal EnableDelayedExpansion
title Launch Factory Portal - Homicho Ammunition Engineering Industry

:: Portal URL: passed as argument, or environment variable, or default localhost:3010
set "PORTAL_URL=http://localhost:3010"
if not "%~1"=="" set "PORTAL_URL=%~1"

:: Remove trailing slash if present
if "%PORTAL_URL:~-1%"=="/" set "PORTAL_URL=%PORTAL_URL:~0,-1%"

set "TARGET_URL=%PORTAL_URL%?startup=1&host=%COMPUTERNAME%&user=%USERNAME%"

echo =====================================================================
echo    Homicho Ammunition Engineering Industry Portal
echo =====================================================================
echo.
echo Opening browser to: %TARGET_URL%
echo.

start "" "%TARGET_URL%"

:: Give browser process 2 seconds to launch
timeout /t 2 >nul

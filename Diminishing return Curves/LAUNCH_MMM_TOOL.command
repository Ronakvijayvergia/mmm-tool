#!/bin/bash
# ══════════════════════════════════════════════════
#  MMM Diminishing Returns Curve Tool — Launcher
#  Just double-click this file to start!
# ══════════════════════════════════════════════════

clear
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   MMM Diminishing Returns Curve Tool     ║"
echo "  ║   Setting up... please wait              ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# Move to the folder where this script lives
cd "$(dirname "$0")/mmm_tool"

# Check for Python
if command -v python3 &>/dev/null; then
    PY=python3
elif command -v python &>/dev/null; then
    PY=python
else
    echo "  ❌ Python not found!"
    echo ""
    echo "  Please install Python first:"
    echo "  → Go to https://www.python.org/downloads/"
    echo "  → Download and install Python 3.10+"
    echo ""
    echo "  Press any key to close..."
    read -n 1
    exit 1
fi

echo "  ✓ Found Python: $($PY --version)"
echo ""

# Install required packages
echo "  Installing dependencies (one-time setup)..."
echo "  This may take 1-2 minutes on first run."
echo ""

$PY -m pip install --quiet --upgrade pip 2>/dev/null
$PY -m pip install --quiet streamlit numpy pandas matplotlib seaborn scipy statsmodels scikit-learn pygam pulp deap openpyxl plotly 2>/dev/null

if [ $? -ne 0 ]; then
    echo "  ⚠ Some packages may have failed. Trying with --user flag..."
    $PY -m pip install --quiet --user streamlit numpy pandas matplotlib seaborn scipy statsmodels scikit-learn pygam pulp deap openpyxl plotly 2>/dev/null
fi

echo ""
echo "  ✓ All dependencies ready!"
echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   Starting the app...                    ║"
echo "  ║                                          ║"
echo "  ║   Your browser will open automatically.  ║"
echo "  ║   If not, go to: http://localhost:8501   ║"
echo "  ║                                          ║"
echo "  ║   To stop: close this Terminal window    ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""

# Open browser after a short delay
(sleep 3 && open "http://localhost:8501") &

# Start Streamlit
$PY -m streamlit run app.py --server.headless true --server.port 8501

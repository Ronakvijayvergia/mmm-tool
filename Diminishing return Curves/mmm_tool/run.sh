#!/bin/bash
# Launch the MMM Diminishing Returns Curve Tool
# Usage: bash run.sh

echo "=========================================="
echo " MMM Diminishing Returns Curve Tool"
echo "=========================================="
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 is required but not found."
    exit 1
fi

# Install dependencies if needed
echo "Checking dependencies..."
pip install -q numpy pandas matplotlib seaborn scipy statsmodels scikit-learn pymc arviz pygam pulp deap scikit-optimize streamlit openpyxl plotly 2>/dev/null

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "Starting Streamlit app..."
echo "Open http://localhost:8501 in your browser."
echo ""

cd "$SCRIPT_DIR"
streamlit run app.py --server.headless true --server.port 8501

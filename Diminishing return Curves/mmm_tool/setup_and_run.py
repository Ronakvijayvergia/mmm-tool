"""
One-click setup and launch script.
Run this single file: python setup_and_run.py
It installs dependencies and opens the app in your browser.
"""
import subprocess, sys, os, webbrowser, time

def install():
    pkgs = [
        "streamlit", "numpy", "pandas", "matplotlib", "seaborn",
        "scipy", "statsmodels", "scikit-learn", "pygam", "pulp",
        "deap", "openpyxl", "plotly",
    ]
    print("Installing dependencies...")
    for p in pkgs:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", p],
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print("All dependencies installed.")

def main():
    install()
    app_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.py")
    print("\nStarting MMM Tool...")
    print("Opening http://localhost:8501 in your browser...\n")
    time.sleep(1)
    webbrowser.open("http://localhost:8501")
    subprocess.run([
        sys.executable, "-m", "streamlit", "run", app_path,
        "--server.headless", "true", "--server.port", "8501",
    ])

if __name__ == "__main__":
    main()

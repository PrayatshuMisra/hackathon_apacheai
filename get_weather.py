import os
import requests
import google.generativeai as genai
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
import datetime

# --- Initialization ---
load_dotenv()

# Serve the SPA from the `aura` directory
app = Flask(
    __name__,
    static_folder='aura',
    template_folder='aura',
    static_url_path=''  # allow "/styles.css" and "/app.js" paths to work
)

# Configure the Gemini API
try:
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    model = genai.GenerativeModel('gemini-2.5-flash')
    print("Gemini API configured successfully.")
except Exception as e:
    print(f"Error configuring Gemini API: {e}")
    model = None

# --- Data Fetching ---

def get_metar_data(icao_codes_str: str):
    """Fetches METAR data and returns it as JSON."""
    api_url = f"https://aviationweather.gov/api/data/metar?ids={icao_codes_str}&format=json&latlon=true"
    try:
        response = requests.get(api_url)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching METAR data: {e}")
        return []

def get_taf_data(icao_codes_str: str):
    """Fetches TAF data and returns it as JSON."""
    api_url = f"https://aviationweather.gov/api/data/taf?ids={icao_codes_str}&format=json"
    try:
        response = requests.get(api_url)
        response.raise_for_status()
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Error fetching TAF data: {e}")
        return []

# --- AI Summary Generation ---

def generate_summary_with_gemini(metars, tafs):
    """Generates a concise weather briefing using the Gemini API."""
    if not model:
        # Fallback summary when Gemini is not available
        icao_codes = [m.get('stationId', '') for m in metars if m.get('stationId')]
        route = " → ".join(icao_codes) if icao_codes else "Unknown route"
        
        return f"""
<div class="briefing-content">
  <table class="briefing-table">
    <tr><th>Route Summary</th><td>Weather briefing for {route}. Conditions appear favorable for flight operations.</td></tr>
    <tr><th>Recommendations</th><td>Monitor weather conditions and maintain standard flight procedures.</td></tr>
  </table>
  
  <div class="per-airport-section">
    <button class="read-more-btn" onclick="togglePerAirport()">Read More >></button>
    <div class="per-airport-content" style="display:none;">
      <h3>Per-Airport Conditions</h3>
      <ul>
        <li><strong>Note</strong>: AI weather analysis unavailable. Please check official weather sources.</li>
      </ul>
    </div>
  </div>
</div>
        """

    metar_texts = "\n".join([m.get('rawOb', '') for m in metars])
    taf_texts = "\n".join([t.get('rawTAF', '') for t in tafs])

    if not metar_texts and not taf_texts:
        return "Not enough data to generate a summary."

    # Defaults for template variables referenced in the prompt
    pilot_profile = os.getenv("PILOT_PROFILE", "General aviation VFR pilot")
    airport_directory = " → ".join(sorted({m.get('stationId', '') for m in metars if m.get('stationId')}))
    weather_data = f"METARs:\n{metar_texts}\nTAFs:\n{taf_texts}"

    # Updated prompt with table format and collapsible per-airport section
    prompt = f"""
You are an expert aviation weather briefer. Audience pilot profile: '{pilot_profile}'.

Task:
- Produce a very concise flight weather briefing (HTML format).
- Route summary: Max 2–3 lines, clear & safety-focused.
- Per-airport summary: **exactly 1 line per ICAO**, include only if conditions are extreme 
  (low vis, strong winds, storms, icing, turbulence, etc.).
- Keep plain language, avoid unnecessary details.

HTML Output Structure:
<div class="briefing-content">
  <table class="briefing-table">
    <tr><th>Route Summary</th><td>Brief overall conditions for the route</td></tr>
    <tr><th>Recommendations</th><td>Speed, altitude, or diversion advice</td></tr>
  </table>

  <div class="per-airport-section">
    <button class="read-more-btn" onclick="togglePerAirport()">Read More >></button>
    <div class="per-airport-content" style="display:none;">
      <h3>Per-Airport Conditions</h3>
      <ul>
        <li><strong>ICAO</strong>: 1-line summary (mention all given icao codes)</li>
      </ul>
    </div>
  </div>
</div>

AIRPORT DIRECTORY:
{airport_directory}

RAW WEATHER DATA START
{weather_data}
RAW WEATHER DATA END
"""

    try:
        response = model.generate_content(prompt)
        return response.text  # Already HTML, no manual replacements
    except Exception as e:
        print(f"Error generating content with Gemini: {e}")
        # Return fallback summary on error
        icao_codes = [m.get('stationId', '') for m in metars if m.get('stationId')]
        route = " → ".join(icao_codes) if icao_codes else "Unknown route"
        
        return f"""
<div class="briefing-content">
  <table class="briefing-table">
    <tr><th>Route Summary</th><td>Weather briefing for {route}. Please check official weather sources for current conditions.</td></tr>
    <tr><th>Recommendations</th><td>Monitor weather conditions and maintain standard flight procedures.</td></tr>
  </table>
  
  <div class="per-airport-section">
    <button class="read-more-btn" onclick="togglePerAirport()">Read More >></button>
    <div class="per-airport-content" style="display:none;">
      <h3>Per-Airport Conditions</h3>
      <ul>
        <li><strong>Note</strong>: AI weather analysis temporarily unavailable. Please check official weather sources.</li>
      </ul>
    </div>
  </div>
</div>
        """

# --- Flask API Routes ---

@app.route('/')
def home():
    """Serves the main HTML page."""
    return render_template('index.html')

@app.route('/briefing')
def get_briefing():
    """The main API endpoint to get weather data and the AI summary."""
    icao_codes_str = request.args.get('codes', '')
    if not icao_codes_str:
        return jsonify({"error": "No ICAO codes provided"}), 400

    metar_reports = get_metar_data(icao_codes_str)
    taf_reports = get_taf_data(icao_codes_str)
    
    summary = generate_summary_with_gemini(metar_reports, taf_reports)

    response_data = {
        "summary": summary,
        "metar_reports": metar_reports,
        "taf_reports": taf_reports
    }
    
    return jsonify(response_data)

# --- Main Execution ---

@app.route('/api/convert-to-pirep', methods=['POST'])
def convert_to_pirep():
    """Converts plain text pilot report to standardized PIREP format."""
    try:
        data = request.get_json()
        user_text = data.get('text', '').strip()
        
        if not user_text:
            return jsonify({'error': 'No text provided'}), 400
            
        # Import the conversion function
        from engtopirep import convert_english_to_pirep
        
        try:
            pirep = convert_english_to_pirep(user_text)
            return jsonify({
                'success': True,
                'pirep': pirep
            })
        except Exception as e:
            return jsonify({
                'success': False,
                'error': str(e)
            }), 500
            
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5001)

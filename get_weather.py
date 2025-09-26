import os
import requests
import google.generativeai as genai
from flask import Flask, request, jsonify, render_template
from dotenv import load_dotenv
import datetime

# Supabase REST config (server-side)
SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

def insert_pirep_row(time_utc_iso: str, icao: str, pirep: str, aircraft_name: str):
    """Best-effort insert into Supabase via REST; does not raise on error."""
    try:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return {"skipped": True, "reason": "Supabase not configured"}
        url = f"{SUPABASE_URL}/rest/v1/pireps"
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        payload = [{
            "time_utc": time_utc_iso,
            "icao": icao,
            "pirep": pirep,
            "aircraft_name": aircraft_name,
        }]
        resp = requests.post(url, headers=headers, json=payload, timeout=10)
        if not resp.ok:
            return {"error": f"{resp.status_code} {resp.text}"}
        return {"success": True}
    except Exception as e:
        return {"error": str(e)}

def parse_icao_from_pirep(pirep_line: str) -> str:
    try:
        import re
        # Match /OV <ICAO><optional digits> or /OV <ICAO> <rest>
        m = re.search(r"/OV\s+([A-Z]{4})", pirep_line or "")
        return m.group(1) if m else ""
    except Exception:
        return ""

def get_recent_pireps(icao_codes: list) -> list:
    """Retrieve PIREPs from database for given ICAO codes that are less than 6 hours old."""
    try:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            return []
        
        # Calculate 6 hours ago in UTC
        six_hours_ago = datetime.datetime.utcnow() - datetime.timedelta(hours=6)
        six_hours_ago_iso = six_hours_ago.isoformat() + 'Z'
        
        # Convert ICAO codes to uppercase for consistent matching
        icao_codes_upper = [code.upper() for code in icao_codes if code]
        
        if not icao_codes_upper:
            return []
        
        # Build query URL with filters
        # Filter by time (greater than 6 hours ago) and ICAO codes
        icao_filter = ','.join([f'"{icao}"' for icao in icao_codes_upper])
        url = f"{SUPABASE_URL}/rest/v1/pireps?time_utc=gte.{six_hours_ago_iso}&icao=in.({icao_filter})&order=time_utc.desc"
        
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        }
        
        resp = requests.get(url, headers=headers, timeout=10)
        if not resp.ok:
            print(f"Error fetching PIREPs: {resp.status_code} {resp.text}")
            return []
        
        pireps = resp.json()
        print(f"Retrieved {len(pireps)} recent PIREPs for ICAO codes: {icao_codes_upper}")
        return pireps
        
    except Exception as e:
        print(f"Error retrieving PIREPs: {e}")
        return []

def get_notams_data(icao_codes: list) -> list:
    """Retrieve NOTAMs from Supabase database for given ICAO codes."""
    try:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            print("Supabase not configured for NOTAMs.")
            return []
        
        # Convert ICAO codes to uppercase for consistent matching
        icao_codes_upper = [code.upper() for code in icao_codes if code]
        
        if not icao_codes_upper:
            return []
        
        # Build query URL with filters
        icao_filter = ','.join([f'"{icao}"' for icao in icao_codes_upper])
        url = f"{SUPABASE_URL}/rest/v1/notams?icao_code=in.({icao_filter})&order=start_time.desc"
        
        headers = {
            "apikey": SUPABASE_SERVICE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        }
        
        resp = requests.get(url, headers=headers, timeout=10)
        if not resp.ok:
            print(f"Error fetching NOTAMs: {resp.status_code} {resp.text}")
            return []
        
        notams = resp.json()
        print(f"Retrieved {len(notams)} NOTAMs for ICAO codes: {icao_codes_upper}")
        return notams
        
    except Exception as e:
        print(f"Error retrieving NOTAMs: {e}")
        return []

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

def generate_summary_with_gemini(metars, tafs, pireps=None, notams=None):
    """Generates a concise weather briefing using the Gemini API."""
    if pireps is None:
        pireps = []
    if notams is None:
        notams = []
        
    if not model:
        # Fallback summary when Gemini is not available
        icao_codes = [m.get('stationId', '') for m in metars if m.get('stationId')]
        route = " → ".join(icao_codes) if icao_codes else "Unknown route"
        
        # Add PIREP section to fallback
        pirep_section = ""
        if pireps:
            pirep_section = f"""
    <tr><th>Recent PIREPs</th><td>{len(pireps)} pilot report(s) available for route airports (last 6 hours)</td></tr>"""
        
        # Add NOTAMs section to fallback
        notam_section = ""
        if notams:
            notam_section = f"""
    <tr><th>NOTAMs</th><td>{len(notams)} Notice(s) to Airmen active for route airports</td></tr>"""
        
        return f"""
<div class="briefing-content">
  <table class="briefing-table">
    <tr><th>Route Summary</th><td>Weather briefing for {route}. Conditions appear favorable for flight operations.</td></tr>
    <tr><th>Recommendations</th><td>Monitor weather conditions and maintain standard flight procedures.</td></tr>{pirep_section}{notam_section}
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
    
    # Add PIREP data to weather information
    pirep_data = ""
    if pireps:
        pirep_texts = []
        for pirep in pireps:
            time_str = pirep.get('time_utc', '')
            icao = pirep.get('icao', '')
            pirep_text = pirep.get('pirep', '')
            aircraft = pirep.get('aircraft_name', '')
            
            # Format time for display (convert from ISO to readable format)
            try:
                from datetime import datetime
                dt = datetime.fromisoformat(time_str.replace('Z', '+00:00'))
                time_display = dt.strftime('%H:%M UTC')
            except:
                time_display = time_str
            
            pirep_entry = f"[{time_display}] {icao}: {pirep_text}"
            if aircraft:
                pirep_entry += f" (Aircraft: {aircraft})"
            pirep_texts.append(pirep_entry)
        
        pirep_data = f"\n\nRECENT PIREPs (Last 6 Hours):\n" + "\n".join(pirep_texts)

    # Add NOTAMs data to weather information
    notam_data = ""
    if notams:
        notam_texts = []
        for notam in notams:
            icao = notam.get('icao_code', '')
            notam_type = notam.get('notam_type', '')
            description = notam.get('description', '')
            start_time = notam.get('start_time', '')
            end_time = notam.get('end_time', '')
            
            # Format time for display
            try:
                from datetime import datetime
                if start_time:
                    start_dt = datetime.fromisoformat(start_time.replace('Z', '+00:00'))
                    start_display = start_dt.strftime('%Y-%m-%d %H:%M UTC')
                else:
                    start_display = start_time
                    
                if end_time:
                    end_dt = datetime.fromisoformat(end_time.replace('Z', '+00:00'))
                    end_display = end_dt.strftime('%Y-%m-%d %H:%M UTC')
                else:
                    end_display = end_time
            except:
                start_display = start_time
                end_display = end_time
            
            notam_entry = f"{icao} - {notam_type}: {description} (Active: {start_display} to {end_display})"
            notam_texts.append(notam_entry)
        
        notam_data = f"\n\nACTIVE NOTAMs:\n" + "\n".join(notam_texts)

    # Updated prompt with table format and collapsible per-airport section
    prompt = f"""
You are an expert aviation weather briefer. Audience pilot profile: '{pilot_profile}'.

Task:
- Produce a very concise flight weather briefing (HTML format).
- Route summary: Max 2-3 lines, clear & safety-focused.
- Per-airport summary: **exactly 1 line per ICAO**, include only if conditions are extreme 
  (low vis, strong winds, storms, icing, turbulence, etc.).
- PIREP Integration: If PIREPs are available, add a "Recent PIREPs" row to the table and mention significant pilot reports in your analysis.
- NOTAMs Integration: If NOTAMs are available, add a "NOTAMs" row to the table and highlight critical operational restrictions.
- Keep plain language, avoid unnecessary details.

HTML Output Structure:
<div class="briefing-content">
  <table class="briefing-table">
    <tr><th>Route Summary</th><td>Brief overall conditions for the route</td></tr>
    <tr><th>Recommendations</th><td>Speed, altitude, or diversion advice</td></tr>
    {f'<tr><th>Recent PIREPs</th><td>Highlight significant pilot reports from the last 6 hours</td></tr>' if pireps else ''}
    {f'<tr><th>NOTAMs</th><td>Critical operational restrictions and closures</td></tr>' if notams else ''}
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
{weather_data}{pirep_data}{notam_data}
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
        
        # Add PIREP section to error fallback
        pirep_section = ""
        if pireps:
            pirep_section = f"""
    <tr><th>Recent PIREPs</th><td>{len(pireps)} pilot report(s) available for route airports (last 6 hours)</td></tr>"""
        
        # Add NOTAMs section to error fallback
        notam_section = ""
        if notams:
            notam_section = f"""
    <tr><th>NOTAMs</th><td>{len(notams)} Notice(s) to Airmen active for route airports</td></tr>"""
        
        return f"""
<div class="briefing-content">
  <table class="briefing-table">
    <tr><th>Route Summary</th><td>Weather briefing for {route}. Please check official weather sources for current conditions.</td></tr>
    <tr><th>Recommendations</th><td>Monitor weather conditions and maintain standard flight procedures.</td></tr>{pirep_section}{notam_section}
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
    include_notams = request.args.get('include_notams', 'false').lower() == 'true'
    
    if not icao_codes_str:
        return jsonify({"error": "No ICAO codes provided"}), 400

    # Parse ICAO codes from the comma-separated string
    icao_codes = [code.strip().upper() for code in icao_codes_str.split(',') if code.strip()]
    
    # Fetch weather data
    metar_reports = get_metar_data(icao_codes_str)
    taf_reports = get_taf_data(icao_codes_str)
    
    # Fetch recent PIREPs for the route
    pirep_reports = get_recent_pireps(icao_codes)
    
    # Fetch NOTAMs if requested
    notam_reports = []
    if include_notams:
        notam_reports = get_notams_data(icao_codes)
    
    # Generate summary with PIREP and NOTAM integration
    summary = generate_summary_with_gemini(metar_reports, taf_reports, pirep_reports, notam_reports)

    response_data = {
        "summary": summary,
        "metar_reports": metar_reports,
        "taf_reports": taf_reports,
        "pirep_reports": pirep_reports,
        "notam_reports": notam_reports
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

            # Server-side insert to Supabase (best-effort)
            time_iso = datetime.datetime.utcnow().isoformat() + 'Z'
            # Prefer ICAO parsed from PIREP /OV segment; fallback to client hint
            icao_guess = parse_icao_from_pirep(pirep) or (data.get('icao') or '').upper()
            aircraft_name = data.get('aircraftModel') or data.get('aircraft_name') or ''
            _ = insert_pirep_row(time_iso, icao_guess, pirep, aircraft_name)

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

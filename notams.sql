CREATE TABLE NOTAMs (
    notam_id SERIAL PRIMARY KEY,
    icao_code VARCHAR(4) NOT NULL,        -- ICAO airport code
    notam_type VARCHAR(50),               -- e.g., RWY Closure, NAV Aid Outage
    description TEXT,                     -- full NOTAM description
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL
);

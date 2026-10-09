# Example API response

The project reads a JSON array from the Socrata SODA endpoint and normalizes
each source row into the output columns listed in `README.md`. The example
below is one real Colorado row requested from:

```text
https://data.colorado.gov/resource/4ykn-tg5h.json
```

## Raw Socrata result

The CLI uses the fields it needs from a row like this:

```json
{
  "entityid": "20268078805",
  "entityname": "Company 1485, LLC",
  "entitytype": "DLLC",
  "entityformdate": "2026-11-01T00:00:00.000",
  "entitystatus": "Good Standing",
  "principalcity": "Boulder",
  "principalzipcode": "80303"
}
```

The Socrata endpoint itself returns rows inside a JSON array. Other source
datasets can have different field names and additional fields.

## Normalized result

After column detection and normalization, one result has this shape:

```json
{
  "state": "CO",
  "entity_id": "20268078805",
  "business_name": "Company 1485, LLC",
  "entity_type": "DLLC",
  "formation_date": "2026-11-01",
  "city": "Boulder",
  "zip": "80303",
  "source_domain": "data.colorado.gov"
}
```

The CLI writes these normalized results to CSV; it does not expose a separate
HTTP API endpoint.

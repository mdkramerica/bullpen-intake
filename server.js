const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy Airtable submissions (keeps API key server-side)
app.post('/submit', async (req, res) => {
  const AIRTABLE_KEY = process.env.AIRTABLE_KEY;
  const BASE_ID = 'appWejlYQqgp0rm66';
  const TABLE_ID = 'tbl06d25rMXJpZUUo';

  try {
    const raw = req.body;

    // Parse companies JSON if it came in as a string
    let companies = [];
    try {
      companies = typeof raw.Companies === 'string' ? JSON.parse(raw.Companies) : (raw.Companies || []);
    } catch(e) { companies = []; }
    const primary = companies[0] || {};
    const secondary = companies.slice(1);

    // Map to Airtable column names (flat structure matching existing table)
    const fields = {
      // Personal
      'First Name':     raw['First Name'] || '',
      'Last Name':      raw['Last Name'] || '',
      'Email':          raw['Email'] || '',
      'Phone':          raw['Phone'] || '',
      'LinkedIn URL':   raw['LinkedIn URL'] || '',
      'City':           raw['City'] || '',
      'State':          raw['State'] || '',
      'Country':        raw['Country'] || '',
      'Member Role':    raw['Member Role'] || '',
      'Functional Expertise': raw['Functional Expertise'] || '',
      'Accomplishments': raw['Accomplishments'] || '',
      'Community Participation': raw['Community Participation'] || '',
      'Connections Offer': raw['Connections Offer'] || '',
      'Connection Strength': raw['Connection Strength'] || '',
      'Connections Seeking': raw['Connections Seeking'] || '',
      'Timeline Urgency': raw['Timeline Urgency'] || '',

      // Primary company — flat columns
      'Company':        primary.name || '',
      'Title':          primary.title || '',
      'Vertical':       primary.vertical || '',
      'Modality':       primary.modality || '',
      'Target Disease': primary.target_disease || '',
      'Company Stage':  primary.company_stage || '',
      'Financial Stage': primary.financial_stage || '',
      'Raise':          primary.raise || '',
      'Company Description': primary.description || '',
      'What You Can Offer': primary.can_offer || '',
      'Looking For':    primary.looking_for || '',
      'Connection Types Seeking': primary.connection_types_seeking || '',
      'Priority 90 Days': primary.priority_90 || '',
      'Professional Services Seeking': primary.services_seeking || '',
      'Professional Services Offering': primary.services_offering || '',
      'Seeking Timeline': primary.seeking_timeline || '',

      // Capital
      'Deploying Capital':   raw['Deploying Capital'] || '',
      'Investment Mandate':  raw['Investment Mandate'] || '',
      'AUM':                 raw['AUM'] || '',
      'Fund Size':           raw['Fund Size'] || '',
      'Check Size':          raw['Check Size'] || '',
      'Preferred Stage':     raw['Preferred Stage'] || '',
      'Preferred Verticals': raw['Preferred Verticals'] || '',
      'Participation Style': raw['Participation Style'] || '',
      'Board Required':      raw['Board Required'] || '',
      'Dry Powder':          raw['Dry Powder'] || '',
      'Investor Geography':  raw['Investor Geography'] || '',
      'Investor Notes':      raw['Investor Notes'] || '',

      // Additional companies (2+) stored as JSON
      'Companies': secondary.length > 0 ? JSON.stringify(secondary) : '',

      'Additional Notes': raw['Additional Notes'] || '',
      'Submitted At':     raw['Submitted At'] || new Date().toISOString()
    };

    // Remove empty strings to keep Airtable clean
    Object.keys(fields).forEach(k => { if (fields[k] === '') delete fields[k]; });

    const response = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ fields })
    });

    const data = await response.json();
    if (response.ok) {
      res.json({ success: true, id: data.id });
    } else {
      res.status(400).json({ success: false, error: data });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// LinkedIn enrichment proxy — keeps RapidAPI key server-side
app.get('/enrich', async (req, res) => {
  const { linkedin_url } = req.query;
  if (!linkedin_url) return res.status(400).json({ success: false, error: 'linkedin_url required' });

  const RAPID_KEY = process.env.RAPIDAPI_KEY;
  if (!RAPID_KEY) return res.status(500).json({ success: false, error: 'RAPIDAPI_KEY not configured' });

  try {
    const params = new URLSearchParams({
      linkedin_url,
      include_skills: 'false',
      include_certifications: 'false',
      include_publications: 'false',
      include_honors: 'false',
      include_volunteers: 'false',
      include_projects: 'false',
      include_patents: 'false',
      include_courses: 'false',
      include_organizations: 'false',
      include_profile_status: 'false',
      include_company_public_url: 'true'
    });

    const response = await fetch(
      `https://fresh-linkedin-profile-data.p.rapidapi.com/enrich-lead?${params}`,
      {
        headers: {
          'x-rapidapi-key': RAPID_KEY,
          'x-rapidapi-host': 'fresh-linkedin-profile-data.p.rapidapi.com'
        }
      }
    );

    const raw = await response.json();
    if (!response.ok || raw.message !== 'ok') {
      return res.json({ success: false, error: raw.message || 'Enrichment failed' });
    }

    const d = raw.data || {};
    // Map to form-friendly shape
    const profile = {
      first_name: d.first_name || '',
      last_name: d.last_name || '',
      city: d.city ? d.city.split(' ').slice(0, -1).join(' ') : '',
      state: d.state || (d.city ? d.city.split(' ').pop() : ''),
      country: d.country || '',
      headline: d.headline || '',
      companies: (d.experiences || [])
        .filter(e => !e.end_date) // current positions only
        .slice(0, 3)
        .map(e => ({
          name: e.company || '',
          title: e.title || '',
          website: e.company_website || '',
          linkedin_url: e.company_linkedin_url || '',
          industry: e.company_industry || ''
        }))
    };

    // If no current positions, fall back to most recent
    if (profile.companies.length === 0 && d.experiences?.length > 0) {
      const e = d.experiences[0];
      profile.companies = [{
        name: e.company || '',
        title: e.title || '',
        website: e.company_website || '',
        linkedin_url: e.company_linkedin_url || '',
        industry: e.company_industry || ''
      }];
    }

    res.json({ success: true, profile });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bullpen intake running on port ${PORT}`));

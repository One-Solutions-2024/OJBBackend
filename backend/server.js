const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const app = express();
const port = process.env.PORT || 5000;

// Configure PostgreSQL connection
const pool = new Pool({
  connectionString: "postgresql://xrjobs_86m6_user:STNmncv6h82vs7EOMxFbLymeoiteotZY@dpg-cv5uatan91rc73b8r3g0-a.oregon-postgres.render.com/xrjobs_86m6",
  ssl: { rejectUnauthorized: false }
});

// Create jobs table
const initializeDB = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        company VARCHAR(255) NOT NULL,
        company_image TEXT,
        location VARCHAR(255),
        url VARCHAR(255) UNIQUE NOT NULL,
        date_posted VARCHAR(50),
        source VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[DB] Table initialized successfully');
  } catch (err) {
    console.error('[DB] Initialization error:', err);
  }
};

// Improved LinkedIn Parser with proper image handling
const linkedInParser = async (html) => {
  try {
    const $ = cheerio.load(html);
    const jobs = [];
    
    $('li').each((i, el) => {
      try {
        const title = $(el).find('.base-search-card__title').text().trim();
        const company = $(el).find('.base-search-card__subtitle').text().trim().replace(/·\s*/, '');
        const location = $(el).find('.job-search-card__location').text().trim();
        const rawUrl = $(el).find('.base-card__full-link').attr('href');
        
        // Improved image handling
        const logoElement = $(el).find('.base-search-card__logo img');
        let companyImage = 
          logoElement.attr('data-delayed-url') ||
          logoElement.attr('data-ghost-url') ||
          logoElement.attr('src');

        if (companyImage) {
          // Handle LinkedIn's image CDN properly
          if (companyImage.startsWith('/')) {
            if (companyImage.startsWith('/dms/image')) {
              companyImage = `https://media.licdn.com${companyImage}`;
            } else {
              companyImage = `https://www.linkedin.com${companyImage}`;
            }
          }
          
          // Ensure HTTPS and clean URL
          companyImage = companyImage.replace(/^http:/, 'https:')
            .replace(/([^:]\/)\/+/g, '$1')
            .split('?')[0];
        }

        // Normalize job URL
        const urlObj = new URL(rawUrl);
        urlObj.searchParams.delete('refId');
        urlObj.searchParams.delete('trackingId');
        const cleanUrl = urlObj.toString().split('?')[0];

        const datePosted = $(el).find('time').attr('datetime') || new Date().toISOString().split('T')[0];

        if (isFresherJob(title)) {
          jobs.push({
            title,
            company,
            company_image: companyImage || null,
            location,
            url: cleanUrl,
            date_posted: datePosted,
            source: 'LinkedIn'
          });
        }
      } catch (err) {
        console.error('Error parsing job element:', err);
      }
    });

    return jobs;
  } catch (err) {
    console.error('LinkedIn parser error:', err);
    return [];
  }
};

// Fresher job check
function isFresherJob(title) {
  return /(fresher|entry[\s-]level|0\s*-\s*1\s*year|junior)/i.test(title);
}

// Job sources configuration with pagination
const jobSources = [
  {
    name: 'LinkedIn Developers',
    baseParams: 'keywords=software%2Bdeveloper%2B(fresher%20OR%20entry%20level)&location=India',
    pages: 3
  },
  {
    name: 'LinkedIn Testers',
    baseParams: 'keywords=(qa%2Btester%2B(fresher%20OR%20entry%20level))%20OR%20(quality%2Bassurance%2B(fresher%20OR%20entry%20level))&location=India',
    pages: 3
  }
];

// Enhanced scraping with pagination
const scrapeJobs = async () => {
  let totalJobs = 0;
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15'
  ];

  try {
    for (const source of jobSources) {
      console.log(`[Scraper] Scraping ${source.name}...`);
      
      for (let page = 0; page < source.pages; page++) {
        const start = page * 25;
        const url = `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${source.baseParams}&start=${start}`;

        try {
          const response = await axios.get(url, {
            headers: {
              'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
              'Accept-Language': 'en-US,en;q=0.9',
              'Referer': 'https://www.linkedin.com/jobs/search/'
            },
            timeout: 15000
          });

          const jobs = await linkedInParser(response.data);
          console.log(`Parsed ${jobs.length} jobs from ${source.name} page ${page + 1}`);

          for (const job of jobs) {
            try {
              const existing = await pool.query(
                'SELECT 1 FROM jobs WHERE url = $1', 
                [job.url]
              );
              
              if (existing.rows.length > 0) continue;

              const result = await pool.query(
                `INSERT INTO jobs (title, company, company_image, location, url, date_posted, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [job.title, job.company, job.company_image, job.location, job.url, job.date_posted, job.source]
              );

              if (result.rowCount > 0) {
                totalJobs++;
                console.log(`Added: ${job.title} - ${job.company}`);
              }
            } catch (err) {
              console.error(`Database error for ${job.url}:`, err.message);
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (error) {
          console.error(`[Scraper] Error fetching page ${page + 1}:`, error.message);
        }
        
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  } catch (error) {
    console.error('[Scraper] Global error:', error.message);
  }

  console.log(`[Scraper] Total new jobs added: ${totalJobs}`);
  return totalJobs;
};

// Server setup
const startServer = async () => {
  await initializeDB();
  
  app.use(cors());
  app.use(express.json());

  // Jobs endpoint with improved filtering
  app.get('/api/jobs', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT id, title, company, company_image, location, url, date_posted, source
        FROM jobs 
        WHERE
          location ILIKE '%india%' AND
          title ILIKE ANY(ARRAY[
            '%software developer%',
            '%software engineer%',
            '%tester%',
            '%qa%',
            '%quality assurance%',
            '%manual testing%',
            '%automation testing%',
            '%test engineer%',
            '%sdet%',
            '%junior%'
          ]) AND
          title ~* '\\y(fresher|entry\\s*level|0\\s*-\\s*1\\s*year|junior)\\y'
        ORDER BY created_at DESC
        LIMIT 100
      `);
      res.json(rows);
    } catch (err) {
      console.error('[API] Error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.get('/api/jobs/:id', async (req, res) => {
    try {
      const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [req.params.id]);
      rows.length ? res.json(rows[0]) : res.status(404).json({ error: 'Job not found' });
    } catch (err) {
      console.error('[API] Error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  app.listen(port, () => {
    console.log(`[Server] Running on port ${port}`);
    
    // Initial cleanup and scrape
    pool.query('TRUNCATE TABLE jobs RESTART IDENTITY')
      .then(() => {
        console.log('[DB] Table truncated for fresh start');
        scrapeJobs().then(count => console.log(`Initial scrape completed: ${count} jobs`));
      })
      .catch(err => console.error('[DB] Truncate error:', err));

    // Hourly scraping
    cron.schedule('0 * * * *', () => {
      console.log('[Cron] Starting scheduled scrape');
      scrapeJobs();
    });
  });
};

startServer();
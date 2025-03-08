// backend/server.js
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
  connectionString: "postgresql://xrjobs_3r6m_user:S0n3q4FUOskQvSibTufSeh5zSMM2L81f@dpg-cv5s0man91rc73b82dqg-a.oregon-postgres.render.com/xrjobs_3r6m",
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

// Updated LinkedIn Parser with improved company image handling
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
        
        // Improved image extraction: prioritize data-delayed-url first
        const logoElement = $(el).find('.base-search-card__logo img');
        let companyImage = 
          logoElement.attr('data-delayed-url') ||
          logoElement.attr('data-ghost-url') ||
          logoElement.attr('src');

        if (companyImage) {
          // If URL is relative, convert to absolute using LinkedIn domain
          if (!companyImage.startsWith('http')) {
            companyImage = `https://www.linkedin.com${companyImage}`;
          }
          // Force HTTPS and remove duplicate slashes (except after protocol)
          companyImage = companyImage.replace(/^http:/, 'https:').replace(/([^:]\/)\/+/g, '$1');
          // Keep query parameters intact since they may be needed for image delivery
        }

        // Normalize job posting URL by removing unnecessary query parameters
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

    return jobs.slice(0, 15);
  } catch (err) {
    console.error('LinkedIn parser error:', err);
    return [];
  }
};

// Fresher job check
function isFresherJob(title) {
  return /(fresher|entry-level|0-1 year|0-\s*1 year)/i.test(title);
}

// LinkedIn configuration
const jobSources = [
  {
    name: 'LinkedIn Developers',
    url: 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=software%2Bdeveloper%2Bfresher&location=India&position=1&pageNum=0',
    parser: linkedInParser
  },
  {
    name: 'LinkedIn Testers',
    url: 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=(qa%2Btester%2Bfresher)%20OR%20(quality%2Bassurance%2Bfresher)&location=India&position=1&pageNum=0',
    parser: linkedInParser
  }
];

// Enhanced scraping function with delays and rotation
const scrapeJobs = async () => {
  let totalJobs = 0;
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15'
  ];

  try {
    for (const source of jobSources) {
      console.log(`[Scraper] Scraping ${source.name}...`);
      
      try {
        const response = await axios.get(source.url, {
          headers: {
            'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
            'Accept-Language': 'en-US,en;q=0.9',
            'Referer': 'https://www.linkedin.com/jobs/search/'
          },
          timeout: 15000
        });

        const jobs = await source.parser(response.data);
        console.log(`Parsed ${jobs.length} jobs from ${source.name}`);

        for (const job of jobs) {
          try {
            // Check for existing URL
            const existing = await pool.query(
              'SELECT 1 FROM jobs WHERE url = $1', 
              [job.url]
            );
            
            if (existing.rows.length > 0) {
              console.log(`Skipping duplicate: ${job.url}`);
              continue;
            }

            // Insert new job with company image
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
          
          // Add delay between inserts
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`[Scraper] Error fetching ${source.name}:`, error.message);
      }

      // Add delay between sources
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (error) {
    console.error('[Scraper] Global error:', error.message);
  }

  console.log(`[Scraper] Total new jobs added: ${totalJobs}`);
  return totalJobs;
};

// Server setup with test endpoint
const startServer = async () => {
  await initializeDB();
  
  app.use(cors());
  app.use(express.json());

  // Test DB endpoint
  app.get('/api/test-db', async (req, res) => {
    try {
      const testJob = {
        title: `Test Job ${Date.now()}`,
        company: 'Test Company',
        company_image: 'https://via.placeholder.com/100',
        location: 'Remote',
        url: `https://example.com/test-${Date.now()}`,
        date_posted: new Date().toISOString(),
        source: 'Test'
      };

      await pool.query(
        `INSERT INTO jobs (title, company, company_image, location, url, date_posted, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        Object.values(testJob)
      );

      res.json({ success: true, message: 'Test job inserted' });
    } catch (err) {
      console.error('Test DB Error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // Jobs endpoints
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
            '%sdet%'
          ]) AND
          title ILIKE ANY(ARRAY['%fresher%', '%entry level%', '%0-1 years%'])
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
    
    // Initial scrape with cleanup option
    pool.query('TRUNCATE TABLE jobs RESTART IDENTITY')
      .then(() => {
        console.log('[DB] Table truncated for fresh start');
        scrapeJobs().then(count => console.log(`Initial scrape completed: ${count} jobs`));
      })
      .catch(err => console.error('[DB] Truncate error:', err));

    // Regular scraping schedule
    cron.schedule('0 */1 * * *', () => {
      console.log('[Cron] Starting scheduled scrape');
      scrapeJobs();
    });
  });
};

startServer();

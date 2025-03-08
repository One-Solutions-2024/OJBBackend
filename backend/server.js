// backend/server.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const port = process.env.PORT || 5000;

// Configure PostgreSQL connection
const pool = new Pool({
  connectionString: "postgresql://xrjobs_a6uj_user:Vz93DhcEDKnqSS6GvESW8Y3NcjFzIa88@dpg-cv56lcnnoe9s73eec820-a.oregon-postgres.render.com/xrjobs_a6uj",
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
        company_image VARCHAR(255),
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

// LinkedIn parser using HTML scraping
const jobSources = [
  {
    name: 'LinkedIn',
    url: 'https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=software%2Bdeveloper%2Bfresher&location=India&position=1&pageNum=0',
    parser: async (html) => {
      try {
        const $ = cheerio.load(html);
        const jobs = [];
        
        $('li').each((i, el) => {
          const title = $(el).find('.base-search-card__title').text().trim();
          const company = $(el).find('.base-search-card__subtitle').text().trim();
          const location = $(el).find('.job-search-card__location').text().trim();
          const url = $(el).find('.base-card__full-link').attr('href').split('?')[0];
          const datePosted = $(el).find('time').attr('datetime') || new Date().toISOString().split('T')[0];

          if (isFresherJob(title)) {
            jobs.push({
              title,
              company: company.replace(/·\s*/, ''),
              location,
              url,
              date_posted: datePosted,
              source: 'LinkedIn'
            });
          }
        });

        return jobs.slice(0, 15);
      } catch (err) {
        console.error('LinkedIn parser error:', err);
        return [];
      }
    }
  }
];

function isFresherJob(title) {
  return /(fresher|entry-level|0-1 year|0-\s*1 year)/i.test(title);
}

// Updated scraping function for LinkedIn
const scrapeJobs = async () => {
  let totalJobs = 0;
  
  try {
    for (const source of jobSources) {
      console.log(`[Scraper] Scraping ${source.name}...`);
      
      const response = await axios.get(source.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.linkedin.com/jobs/search/'
        },
        timeout: 10000
      });

      const jobs = await source.parser(response.data);
      console.log(`Parsed ${jobs.length} valid jobs from ${source.name}`);

      for (const job of jobs) {
        try {
          const result = await pool.query(
            `INSERT INTO jobs (title, company, location, url, date_posted, source)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (url) DO NOTHING`,
            [job.title, job.company, job.location, job.url, job.date_posted, job.source]
          );
          if (result.rowCount > 0) totalJobs++;
        } catch (err) {
          console.error(`Database error for ${job.url}:`, err.message);
        }
      }
    }
  } catch (error) {
    console.error('[Scraper] Error:', error.message);
  }

  console.log(`[Scraper] Total new jobs added: ${totalJobs}`);
  return totalJobs;
};

// Server setup remains the same
const startServer = async () => {
  await initializeDB();
  
  app.use(cors());
  app.use(express.json());

  app.get('/api/jobs', async (req, res) => {
    try {
      const { rows } = await pool.query(`
        SELECT id, title, company, location, url, date_posted, source
        FROM jobs 
        WHERE
          location ILIKE '%india%' AND
          title ILIKE ANY(ARRAY['%software developer%', '%software engineer%', '%tester%', '%qa%']) AND
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
    scrapeJobs().then(count => console.log(`Initial scrape completed: ${count} jobs`));
    cron.schedule('0 */3 * * *', () => scrapeJobs());
  });
};

startServer();
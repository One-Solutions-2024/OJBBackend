// backend/server.js
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

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

// Updated LinkedIn parser with working selectors
const jobSources = [
  {
    name: 'LinkedIn',
    url: 'https://www.linkedin.com/jobs/search/?keywords=software%20developer%20fresher&location=India&position=1&pageNum=0',
    parser: async (page) => {
      try {
        // Bypass initial dialogs
        try {
          await page.waitForSelector('button[data-tracking-control-name="public_jobs_modal-close"]', { timeout: 5000 });
          await page.click('button[data-tracking-control-name="public_jobs_modal-close"]');
          console.log('Closed initial dialog');
        } catch (e) {}

        // Wait for job list
        await page.waitForSelector('.jobs-search__results-list', { timeout: 30000 });
        
        // Scroll to load jobs
        await autoScroll(page);

        // Get job elements
        const jobElements = await page.$$('.jobs-search__results-list li');
        console.log(`Found ${jobElements.length} job elements`);

        const jobs = [];
        for (const el of jobElements.slice(0, 15)) {
          try {
            const title = await el.$eval('.base-search-card__title', n => n.innerText.trim());
            const company = await el.$eval('.base-search-card__subtitle', n => n.innerText.trim());
            const location = await el.$eval('.job-search-card__location', n => n.innerText.trim());
            const url = await el.$eval('a.base-card__full-link', n => n.href.split('?')[0]);
            
            // Date handling
            const dateElement = await el.$('time');
            const datePosted = dateElement ? 
              await dateElement.evaluate(n => n.getAttribute('datetime') || '') : 
              new Date().toISOString().split('T')[0];

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
          } catch (err) {
            console.error('Error parsing job element:', err);
          }
        }
        return jobs;
      } catch (err) {
        console.error('LinkedIn parser error:', err);
        return [];
      }
    }
  }
];

// Improved auto-scroll function
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 500;
      const timer = setInterval(() => {
        const scrollHeight = document.body.scrollHeight;
        window.scrollBy(0, distance);
        totalHeight += distance;
        
        if (totalHeight >= scrollHeight * 0.7) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
    });
  });
}

function isFresherJob(title) {
  return /(fresher|entry-level|0-1 year|0-\s*1 year)/i.test(title);
}

// Enhanced scraping function
const scrapeJobs = async () => {
  let browser;
  let totalJobs = 0;
  
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || await puppeteer.executablePath()
    });

    const page = await browser.newPage();
    
    // Set realistic browser fingerprint
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.setViewport({ width: 1366, height: 768 });
    await page.setJavaScriptEnabled(true);

    try {
      console.log('[Scraper] Navigating to LinkedIn...');
      await page.goto(jobSources[0].url, {
        waitUntil: 'networkidle2',
        timeout: 60000
      });

      // Parse jobs
      const jobs = await jobSources[0].parser(page);
      console.log(`Parsed ${jobs.length} valid jobs`);

      // Insert into database
      for (const job of jobs) {
        try {
          const result = await pool.query(
            `INSERT INTO jobs (title, company, location, url, date_posted, source)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (url) DO NOTHING`,
            [job.title, job.company, job.location, job.url, job.date_posted, job.source]
          );
          if (result.rowCount > 0) {
            totalJobs++;
            console.log(`Added: ${job.title} - ${job.company}`);
          }
        } catch (err) {
          console.error(`Database error for ${job.url}:`, err.message);
        }
      }
    } finally {
      await page.close();
    }
  } catch (error) {
    console.error('[Scraper] Error:', error.message);
  } finally {
    if (browser) await browser.close();
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
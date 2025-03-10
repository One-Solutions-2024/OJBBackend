const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const puppeteer = require('puppeteer'); // Added for JS rendering

const app = express();
const port = process.env.PORT || 5000;

// Configure PostgreSQL connection
const pool = new Pool({
  connectionString: "postgresql://xrjobs_g5le_user:B9TewldMaMKNEYBmaDZf2CNxZy0Ged7y@dpg-cv78rvl2ng1s7382tus0-a.oregon-postgres.render.com/xrjobs_g5le",
  ssl: { rejectUnauthorized: false }
});


// Expanded list of job sources with improved configuration
const jobSources = [
  {
    name: 'LinkedIn Developers',
    type: 'api',
    url: (page) => `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=software%20developer%20(fresher%20OR%20entry%20level)&location=India&start=${page * 25}`,
    parser: linkedInParser,
    pages: 3,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  },
  {
    name: 'LinkedIn Testers',
    type: 'api',
    url: (page) => `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=(qa%20tester%20(fresher%20OR%20entry%20level))%20OR%20(quality%20assurance%20(fresher%20OR%20entry%20level))&location=India&start=${page * 25}`,
    parser: linkedInParser,
    pages: 3,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15'
    }
  },

  // Indian IT Companies
  {
    name: 'TCS Careers',
    type: 'website',
    url: 'https://www.tcs.com/careers',
    parser: tcsParser,
    params: { country: 'India', department: 'Technology' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
  },
  {
    name: 'Infosys Careers',
    type: 'website',
    url: 'https://www.infosys.com/careers.html',
    parser: infosysParser,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      'Referer': 'https://www.infosys.com/'
    }
  },
  {
    name: 'Wipro Careers',
    type: 'website',
    url: 'https://careers.wipro.com/india-jobs',
    parser: wiproParser,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  },
  {
    name: 'HCL Careers',
    type: 'website',
    url: 'https://www.hcltech.com/careers/job-search',
    parser: hclParser,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  },
  {
    name: 'Tech Mahindra Careers',
    type: 'website',
    url: 'https://www.techmahindra.com/careers/',
    parser: techMahindraParser,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  },

  // Global Companies with India Presence
  {
    name: 'Accenture Careers',
    type: 'website',
    url: 'https://www.accenture.com/in-en/careers/jobsearch',
    parser: accentureParser,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    },
  {
    name: 'IBM Careers',
    type: 'website',
    url: 'https://www.ibm.com/in-en/careers/search/',
    parser: ibmParser,
    params: { country: 'India', department: 'Technology' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    },
  {
    name: 'Capgemini Careers',
    type: 'website',
    url: 'https://www.capgemini.com/in-en/careers/job-search/',
    parser: capgeminiParser,
    params: { country: 'India', department: 'Technology' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  },
  {
    name: 'Cognizant Careers',
    type: 'website',
    url: 'https://careers.cognizant.com/global/en/search-results',
    parser: cognizantParser,
    params: { country: 'India', department: 'Technology' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    },
  {
    name: 'Mindtree Careers',
    type: 'website',
    url: 'https://www.mindtree.com/careers/jobs',
    parser: mindtreeParser,
    params: { country: 'India', department: 'Technology' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  },
  {
    name: 'LTI Careers',
    type: 'website',
    url: 'https://www.lntinfotech.com/careers/',
    parser: ltiParser,
    params: { country: 'India', department: 'Technology' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  },
  {
    name: 'Mphasis Careers',
    type: 'website',
    url: 'https://www.mphasis.com/home/careers.html',
    parser: mphasisParser,
    params: { country: 'India', department: 'Technology' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  },
  {
    name: 'Deloitte Careers',
    type: 'website',
    url: 'https://jobsindia.deloitte.com/',
    parser: deloitteParser,
    params: { country: 'India', department: 'Technology' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
  },
  {
    name: 'Amazon Careers',
    type: 'website',
    url: 'https://www.amazon.jobs/en-gb/search',
    parser: amazonParser,
    params: { country: 'India', department: 'Technology' },
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    }
    }
];

// Database initialization
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
        experience VARCHAR(100),
        employment_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('[DB] Table initialized successfully');
  } catch (err) {
    console.error('[DB] Initialization error:', err);
  }
};


// Improved LinkedIn Parser with proper image handling
async function linkedInParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    
    $('li').each((i, el) => {
      try {
        const titleElem = $(el).find('.base-search-card__title');
        const companyElem = $(el).find('.base-search-card__subtitle');
        const locationElem = $(el).find('.job-search-card__location');
        const linkElem = $(el).find('.base-card__full-link');

        if (!titleElem.length || !companyElem.length) return;

        const title = titleElem.text().trim();
        const company = companyElem.text().trim().replace(/·\s*/, '');
        const location = locationElem.text().trim();
        const rawUrl = linkElem.attr('href') || '';
        
        // URL normalization
        const urlObj = new URL(rawUrl);
        urlObj.searchParams.delete('refId');
        urlObj.searchParams.delete('trackingId');
        const cleanUrl = urlObj.toString().split('?')[0];

        // Image handling
        const logoElem = $(el).find('.base-search-card__logo img');
        let companyImage = logoElem.attr('data-delayed-url') || 
                         logoElem.attr('data-ghost-url') || 
                         logoElem.attr('src');
        if (companyImage) {
          companyImage = companyImage.replace(/^http:/, 'https:')
            .replace(/([^:]\/)\/+/g, '$1')
            .split('?')[0];
          if (companyImage.startsWith('/')) {
            companyImage = companyImage.startsWith('/dms/image') ?
              `https://media.licdn.com${companyImage}` :
              `https://www.linkedin.com${companyImage}`;
          }
        }

        const datePosted = $(el).find('time').attr('datetime') || new Date().toISOString().split('T')[0];

        if (isFresherJob(title)) {
          jobs.push({
            title,
            company,
            company_image: companyImage,
            location,
            url: cleanUrl,
            date_posted: datePosted,
            source: 'LinkedIn'
          });
        }
      } catch (err) {
        console.error('Error parsing LinkedIn job element:', err);
      }
    });
  } catch (err) {
    console.error('LinkedIn parser error:', err);
  }
  return jobs;
}

// TCS Parser
async function tcsParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.search-results-list li').each((i, el) => {
      const titleElem = $(el).find('.job-title a');
      const locationElem = $(el).find('.job-location');
      const dateElem = $(el).find('.job-post-date');

      const title = titleElem.text().trim();
      const url = `https://www.tcs.com${titleElem.attr('href')}`;
      const location = locationElem.text().trim();
      const datePosted = dateElem.text().trim();

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'TCS',
          company_image: 'https://www.tcs.com/etc/designs/tcsRetina/img/tcs-logo.svg',
          location,
          url,
          date_posted: datePosted,
          source: 'TCS Careers'
        });
      }
    });
  } catch (err) {
    console.error('TCS parser error:', err);
  }
  return jobs;
}

async function infosysParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://www.infosys.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Infosys',
          company_image: 'https://www.infosys.com/content/dam/infosys-web/en/global-resources/media-resources/infosys-logo.jpg',
          location,
          url,
          date_posted: datePosted,
          source: 'Infosys Careers'
        });
      }
    });
  } catch (err) {
    console.error('Infosys parser error:', err);
  }
  return jobs;
}

async function accentureParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.job-location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://www.accenture.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Accenture',
          company_image: 'https://www.accenture.com/t00010101T000000Z__w__/in-en/_acnmedia/Accenture/Dev/Redesign/Acc_Logo_Black_Purple_RGB.png',
          location,
          url,
          date_posted: datePosted,
          source: 'Accenture Careers'
        });
      }
    });
  } catch (err) {
    console.error('Accenture parser error:', err);
  }
  return jobs;
}

async function wiproParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.job-location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://careers.wipro.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Wipro',
          company_image: 'https://www.wipro.com/content/dam/nexus/en/brand/logo/wipro-logo.png',
          location,
          url,
          date_posted: datePosted,
          source: 'Wipro Careers'
        });
      }
    });
  } catch (err) {
    console.error('Wipro parser error:', err);
  }
  return jobs;
}

async function hclParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.job-location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://www.hcltech.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'HCL',
          company_image: 'https://www.hcltech.com/themes/custom/hcltech/logo.svg',
          location,
          url,
          date_posted: datePosted,
          source: 'HCL Careers'
        });
      }
    });
  } catch (err) {
    console.error('HCL parser error:', err);
  }
  return jobs;
}

async function ibmParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-item').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.date').text().trim();
      const url = `https://www.ibm.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'IBM',
          company_image: 'https://www.ibm.com/design/language/8d222b0e5c5a21f6a0d69691e6d6a21b/ibm-masthead-logo.svg',
          location,
          url,
          date_posted: datePosted,
          source: 'IBM Careers'
        });
      }
    });
  } catch (err) {
    console.error('IBM parser error:', err);
  }
  return jobs;
}

async function amazonParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-item').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://www.amazon.jobs${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Amazon',
          company_image: 'https://logos-world.net/wp-content/uploads/2020/04/Amazon-Logo.png',
          location,
          url,
          date_posted: datePosted,
          source: 'Amazon Careers'
        });
      }
    });
  } catch (err) {
    console.error('Amazon parser error:', err);
  }
  return jobs;
}

async function mphasisParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://www.mphasis.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Mphasis',
          company_image: 'https://www.mphasis.com/content/dam/mphasis-com/images/logo.png',
          location,
          url,
          date_posted: datePosted,
          source: 'Mphasis Careers'
        });
      }
    });
  } catch (err) {
    console.error('Mphasis parser error:', err);
  }
  return jobs;
}

async function deloitteParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://jobsindia.deloitte.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Deloitte',
          company_image: 'https://jobsindia.deloitte.com/content/dam/deloitte/in/images/logo.png',
          location,
          url,
          date_posted: datePosted,
          source: 'Deloitte Careers'
        });
      }
    });
  } catch (err) {
    console.error('Deloitte parser error:', err);
  }
  return jobs;
}

async function mindtreeParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://www.mindtree.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Mindtree',
          company_image: 'https://www.mindtree.com/sites/all/themes/mindtree/images/logo.png',
          location,
          url,
          date_posted: datePosted,
          source: 'Mindtree Careers'
        });
      }
    });
  } catch (err) {
    console.error('Mindtree parser error:', err);
  }
  return jobs;
}

async function ltiParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://www.lntinfotech.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'LTI',
          company_image: 'https://www.lntinfotech.com/content/dam/lntinfotech/brand/logo.png',
          location,
          url,
          date_posted: datePosted,
          source: 'LTI Careers'
        });
      }
    });
  } catch (err) {
    console.error('LTI parser error:', err);
  }
  return jobs;
}

async function cognizantParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://careers.cognizant.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Cognizant',
          company_image: 'https://careers.cognizant.com/content/dam/cognizant/careers/images/logo.png',
          location,
          url,
          date_posted: datePosted,
          source: 'Cognizant Careers'
        });
      }
    });
  } catch (err) {
    console.error('Cognizant parser error:', err);
  }
  return jobs;
}

async function capgeminiParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://www.capgemini.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Capgemini',
          company_image: 'https://www.capgemini.com/wp-content/themes/capgemini-komposite/assets/images/logo.svg',
          location,
          url,
          date_posted: datePosted,
          source: 'Capgemini Careers'
        });
      }
    });
  } catch (err) {
    console.error('Capgemini parser error:', err);
  }
  return jobs;
}

async function techMahindraParser(html) {
  const jobs = [];
  try {
    const $ = cheerio.load(html);
    $('.job-card').each((i, el) => {
      const title = $(el).find('.job-title').text().trim();
      const location = $(el).find('.location').text().trim();
      const datePosted = $(el).find('.posting-date').text().trim();
      const url = `https://www.techmahindra.com${$(el).find('a').attr('href')}`;

      if (title && isFresherJob(title)) {
        jobs.push({
          title,
          company: 'Tech Mahindra',
          company_image: 'https://www.techmahindra.com/content/dam/tm/logo.png',
          location,
          url,
          date_posted: datePosted,
          source: 'Tech Mahindra Careers'
        });
      }
    });
  } catch (err) {
    console.error('Tech Mahindra parser error:', err);
  }
  return jobs;
}
const scrapeJobs = async () => {
  let totalJobs = 0;
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15'
  ];

  try {
    for (const source of jobSources) {
      console.log(`[Scraper] Scraping ${source.name}...`);
      let jobs = [];

      try {
        if (source.type === 'api') {
          // Handle API-based sources
          for (let page = 0; page < (source.pages || 1); page++) {
            const response = await axios.get(
              typeof source.url === 'function' ? source.url(page) : source.url,
              {
                headers: {
                  ...source.headers,
                  'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)]
                },
                timeout: 15000
              }
            );
            jobs = jobs.concat(await source.parser(response.data));
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        } else {
          // Handle website-based sources
          const response = await axios.get(source.url, {
            params: source.params,
            headers: {
              ...source.headers,
              'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)]
            },
            timeout: 15000
          });
          jobs = await source.parser(response.data);
        }

        console.log(`Parsed ${jobs.length} jobs from ${source.name}`);

        // Database insertion
        for (const job of jobs) {
          try {
            const existing = await pool.query(
              'SELECT 1 FROM jobs WHERE url = $1', 
              [job.url]
            );
            
            if (existing.rows.length === 0) {
              await pool.query(
                `INSERT INTO jobs (title, company, company_image, location, url, date_posted, source)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [job.title, job.company, job.company_image, job.location, job.url, job.date_posted, job.source]
              );
              totalJobs++;
              console.log(`Added: ${job.title} - ${job.company}`);
            }
          } catch (err) {
            console.error(`Database error for ${job.url}:`, err.message);
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      } catch (error) {
        console.error(`[Scraper] Error in ${source.name}:`, error.message);
      }
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  } catch (error) {
    console.error('[Scraper] Global error:', error.message);
  }

  console.log(`[Scraper] Total new jobs added: ${totalJobs}`);
  return totalJobs;
};

// Enhanced job filter
function isFresherJob(title) {
  const patterns = [
    /\b(fresher|freshers)\b/i,
    /\bentry[-\s]?level\b/i,
    /\bjunior\b/i,
    /\bgraduate\b/i,
    /\btrainee\b/i,
    /\bintern\b/i,
    /0-?1\s+years?/i,
    /(software|qa|test)\s+(engineer|developer|tester|analyst)/i
  ];
  return patterns.some(pattern => pattern.test(title));
}
app.use(cors());
app.use(express.json());

app.get('/api/jobs', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT id, title, company, company_image, location, url, date_posted, source
      FROM jobs
      WHERE title ~* $1
      ORDER BY created_at DESC
      LIMIT 300
    `, ['\\y(software|developer|engineer|tester|qa|sdet|quality assurance|entry level|fresher|junior)\\y']);
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

// Server initialization
const startServer = async () => {
  await initializeDB();

  app.listen(port, () => {
    console.log(`[Server] Running on port ${port}`);
    
    // Initial scrape
    // Initial scrape
(async () => {
  try {
    const count = await scrapeJobs();
    console.log(`Initial scrape completed: ${count} jobs added`);
  } catch (err) {
    console.error('Initialization error:', err);
  }
})();
    // Scheduled scraping
    cron.schedule('0 * * * *', () => {
      console.log('[Cron] Starting scheduled scrape');
      scrapeJobs();
    });
  });
};

startServer();
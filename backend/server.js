const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());
const app = express();
const port = process.env.PORT || 5000;

// Configure PostgreSQL connection
const pool = new Pool({
  connectionString: "postgresql://xrjobs_xyew_user:pRYXNGH7H996M3xAKptEqGt0s33TDyCj@dpg-cv7e8ctumphs738hbml0-a.oregon-postgres.render.com/xrjobs_xyew",
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
  {
    name: 'Naukri',
    type: 'puppeteer',
    url: 'https://www.naukri.com/fresher-software-developer-jobs-in-india',
    parser: naukriParser
  },
  {
    name: 'Indeed',
    type: 'puppeteer',
    url: 'https://in.indeed.com/jobs?q=fresher+software+developer&l=India',
    parser: indeedParser
  },


  // Indian IT Companies
  {
    name: 'TCS Careers',
    type: 'puppeteer',
    url: 'https://www.tcs.com/careers',
    parser: tcsParser,
    steps: async (page) => {
      await page.waitForSelector('#country', { timeout: 15000 });
      await page.select('#country', 'India');
      await page.click('.search-button');
      await page.waitForSelector('.search-results-list', { timeout: 20000 });
    }
  },
  {
    name: 'Infosys Careers',
    type: 'puppeteer',
    url: 'https://www.infosys.com/careers.html',
    parser: infosysParser,
    steps: async (page) => {
      await page.click('#professionals');
      await page.waitForSelector('.job-listings', { timeout: 15000 });
    }
  },
  {
    name: 'Wipro Careers',
    type: 'puppeteer',
    url: 'https://careers.wipro.com/india-jobs',
    parser: wiproParser,
    steps: async (page) => {
      await page.waitForSelector('.job-feed', { timeout: 20000 });
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
        salary VARCHAR(100),
        requirements TEXT,
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
        const description = $(el).find('.job-search-card__description').text().trim();
        // Extract salary pattern (e.g., ₹5,00,000 - ₹7,00,000 a year)
        const salaryMatch = description.match(/(₹[\d,]+ - ₹[\d,]+)\s*(?:per\syear|a\syear)/i);
        const salary = salaryMatch ? salaryMatch[1] : null;

        // Extract experience
        const experienceMatch = description.match(/(\d+-\d+\s+years?\s+experience)/i);
        const experience = experienceMatch ? experienceMatch[1] : 'Fresher';

        // Extract requirements
        const requirements = [];
        $(el).find('.job-search-card__description ul li').each((i, li) => {
          requirements.push($(li).text().trim());
        });
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
            source: 'LinkedIn',
            experience,
            employment_type: 'Full-time', // Extract from description if available
            salary,
            requirements: requirements.join('\n')
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
async function indeedParser(html) {
  const $ = cheerio.load(html);
  const jobs = [];

  // This selector may vary based on Indeed's page structure.
  $('.result').each((i, el) => {
    const title = $(el).find('h2.title').text().trim();
    const company = $(el).find('.company').text().trim();
    const location = $(el).find('.location').text().trim();
    let url = $(el).find('h2.title a').attr('href');

    // Normalize URL if needed
    if (url && !url.startsWith('http')) {
      url = `https://in.indeed.com${url}`;
    }

    // Check if job qualifies as fresher
    if (title && isFresherJob(title)) {
      jobs.push({
        title,
        company,
        location,
        url,
        source: 'Indeed',
        experience: 'Fresher',
        date_posted: $(el).find('.date').text().trim()
      });
    }
  });

  return jobs;
}

async function naukriParser(html) {
  const $ = cheerio.load(html);
  const jobs = [];
  
  $('[data-job-id]').each((i, el) => { // Updated selector
    const title = $(el).find('a.title').text().trim();
    const company = $(el).find('.comp-name').text().trim();
    const location = $(el).find('.loc').text().trim();
    const url = $(el).find('a.title').attr('href');
    
    if (isFresherJob(title)) {
      jobs.push({
        title,
        company,
        location,
        url: url.includes('http') ? url : `https://www.naukri.com${url}`,
        source: 'Naukri',
        date_posted: new Date().toISOString().split('T')[0]
      });
    }
  });
  return jobs;
}
// TCS Parser
async function tcsParser(html) {
  const $ = cheerio.load(html);
  const jobs = [];
  
  $('.search-results-item').each((i, el) => {
    const title = $(el).find('.job-title').text().trim();
    const location = $(el).find('.job-location').text().trim();
    const url = $(el).find('a').attr('href');
    const datePosted = $(el).find('.posting-date').text().trim();

    if (isFresherJob(title)) {
      jobs.push({
        title,
        company: 'TCS',
        location,
        url: `https://www.tcs.com${url}`,
        source: 'TCS Careers',
        date_posted: datePosted,
        experience: 'Fresher'
      });
    }
  });
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
          experience: 'Fresher',
          employment_type: 'Full-time',
          salary: 'Not disclosed',
          requirements: 'Bachelor\'s degree in relevant field',
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
async function scrapeWithPuppeteer(url, steps) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    if (steps) {
      await steps(page);
    }

    return await page.content();
  } finally {
    await browser.close();
  }
}


const scrapeJobs = async () => {
  let totalJobs = 0;
  
  for (const source of jobSources) {
    try {
      console.log(`[Scraper] Scraping ${source.name}...`);
      let html;
      
      if (source.type === 'puppeteer') {
        html = await scrapeWithPuppeteer(source.url, source.steps);
      } else if (source.type === 'api') {
        const response = await axios.get(
          typeof source.url === 'function' ? source.url(0) : source.url,
          {
            headers: source.headers,
            timeout: 25000 // Increased timeout
          }
        );
        html = response.data;
      }

      const jobs = await source.parser(html);
      console.log(`Found ${jobs.length} jobs from ${source.name}`);

      // Database insertion
      for (const job of jobs) {
        try {
          const existing = await pool.query(
            'SELECT 1 FROM jobs WHERE url = $1', [job.url]
          );
          
          if (!existing.rows.length) {
            await pool.query(
              `INSERT INTO jobs (
                title, company, location, url, source, 
                experience, date_posted
              ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [job.title, job.company, job.location, job.url, 
               job.source, job.experience, job.date_posted]
            );
            totalJobs++;
          }
        } catch (err) {
          console.error(`DB Error for ${job.url}:`, err.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`[Scraper] Error in ${source.name}:`, error.message);
      if (error.response) {
        console.error(`Status: ${error.response.status}`, `URL: ${error.config.url}`);
      }
    }
    await new Promise(resolve => setTimeout(resolve, 10000)); // Longer delay
  }
  
  return totalJobs;
};

// Enhanced job filter
function isFresherJob(title) {
  const patterns = [
    /\b(fresher|freshers|entry[- ]level|junior)\b/i,
    /0-?[12]\s+years?/i,
    /(software|developer|engineer|tester)\s+(fresher|trainee)/i
  ];
  return patterns.some(p => p.test(title)) && 
    !/\b(senior|experienced|3\+)\b/i.test(title);
}

app.use(cors());
app.use(express.json());

app.get('/api/jobs', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT *
      FROM jobs
      WHERE title ~* $1
      ORDER BY created_at DESC
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
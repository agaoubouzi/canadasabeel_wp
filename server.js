const express = require('express');
const multer = require('multer');
const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
const dotenv = require('dotenv');
const puppeteer = require('puppeteer');
const rateLimit = require('express-rate-limit');

// Load environment variables
dotenv.config({ path: `${__dirname}/config.env` });

const WP_USERNAME = process.env.WP_USERNAME;
const WP_APP_PASSWORD = process.env.WP_PASSWORD;
const WP_PASSWORD_LOGIN = process.env.WP_PASSWORD_LOGIN;
const APP_PASSWORD = process.env.APP_PASSWORD;
const WP_PAGE_1_ID = 1272; // The ID of the page to update (أرشيف ساخر)
const WP_PAGE_2_ID = 1262; // The ID of the page to update (ساخر الورقية)
var real3dflipbookId = 20; // Adjust as needed

// Session management
const session = require('express-session');

const app = express();
const upload = multer({ dest: 'uploads/' });

// Enable 'trust proxy' for handling X-Forwarded-For header in a reverse proxy environment (required for rate-limiting)
app.set('trust proxy', 1); // Trust the first proxy

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

app.use(express.json());

// Define rate limiting for password attempts
const passwordAttemptLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
  message: 'Too many password attempts, please try again later'
});

// Middleware to check authentication
const checkAuth = (req, res, next) => {
  if (req.session.isAuthenticated) {
    next();
  } else {
    res.status(401).json({ message: 'Unauthorized' });
  }
};

// Password verification endpoint with rate limiting
app.post('/verify-password', passwordAttemptLimiter, (req, res) => {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ message: 'Password is required' });
  }

  // Compare the provided password with the environment variable
  if (password === APP_PASSWORD) {
    req.session.isAuthenticated = true;
    return res.status(200).json({ message: 'Password is correct' });
  } else {
    return res.status(403).json({ message: 'Invalid password' });
  }
});


const generateFlipbookId = () => Math.random() * 99 + 1;

const checkFileExists = async (filename) => {
  try {
    const response = await axios.get(`https://www.canadasabeel.com/wp-json/wp/v2/media?search=${encodeURIComponent(filename)}`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64')}`,
      }
    });
    return response.data.length > 0;
  } catch (error) {
    console.error('Error checking file existence:', error.response ? error.response.data : error.message);
    return false;
  }
};

// Upload PDF file to WordPress
// Function to fetch data from an API and return the first PDF URL and its name
async function getOldPdf(pageId) {
  try {
    const pageContentResult = await getPageContent(pageId);
    const data = pageContentResult.data;

    // Validate that data is a string
    if (typeof data !== "string") {
      console.error("Invalid data format: expected a string.");
      return null;
    }

    const pdfMatch = data.match(/<a[^>]*href=["'](https?:\/\/[^\s"']+\.pdf)["'][^>]*>(.*?)<\/a>/);

    if (pdfMatch) {
      const pdfUrl = pdfMatch[1]; // URL from the href attribute
      const pdfName = pdfMatch[2].trim(); // Inner text of the <a> tag
      // Return the result as an object
      return { url: pdfUrl, name: pdfName };
    } else {
      console.log("No PDF link found.");
      return null;
    }
  } catch (error) {
    console.error("Error fetching data:", error);
    throw error; 
  }
}

const getPdfUrl = async (filename) => {
  try {
    const response = await axios.get(`https://www.canadasabeel.com/wp-json/wp/v2/media?search=${encodeURIComponent(filename)}`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64')}`,
      }
    });
    if (response.data.length > 0) {
      return response.data[0].source_url;
    } else {
      throw new Error('File not found');
    }
  } catch (error) {
    console.error('Error retrieving file URL:', error.response ? error.response.data : error.message);
    return null;
  }
};

const uploadPDF = async (filePath, filename) => {
  const fileExists = await checkFileExists(filename);

  if (fileExists) {
    console.log('File already exists. Skipping upload.');
    return { success: true, message: 'File already exists. Skipping upload.', alreadyExists: true };
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath), filename);
  form.append('title', filename);
  form.append('alt_text', `PDF file: ${filename}`);

  try {
    const response = await axios.post('https://www.canadasabeel.com/wp-json/wp/v2/media', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Basic ${Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64')}`,
      }
    });
    return { success: true, data: response.data, alreadyExists: false };
  } catch (error) {
    console.error('Error uploading file:', error.response ? error.response.data : error.message);
    return { success: false, message: error.response ? error.response.data.message : error.message };
  }
};

// Update a WordPress page with the new PDF link
const getPageContent = async (pageId) => {
  try {
    const response = await axios.get(`https://www.canadasabeel.com/wp-json/wp/v2/pages/${pageId}`, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64')}`,
      }
    });
    return { success: true, data: response.data.content.rendered };
  } catch (error) {
    console.error('Error fetching page content:', error.response ? error.response.data : error.message);
    return { success: false, message: error.response ? error.response.data.message : error.message };
  }
};

const updatePageOneWithPDF = async (pageId, newPdfLink, pdfTitle) => {
    const pageContentResult = await getPageContent(pageId);
    if (!pageContentResult.success) {
      return { success: false, message: pageContentResult.message };
    }

    const currentContent = pageContentResult.data;

    if (currentContent.includes(pdfTitle)) {
      console.log('PDF already exists in the page content. Skipping page update.');
      return { success: true, message: 'PDF already exists in the page content. Skipping page update.', alreadyExists: true };
    }


    const newListItem = `<li><a href="${newPdfLink}">${pdfTitle}</a></li>`;
    const updatedContent = currentContent.replace(
      /(<ul[^>]*>)(.*?)(<\/ul>)/s,
      `$1${newListItem}$2$3`
    );

    try {
    const response = await axios.post(`https://www.canadasabeel.com/wp-json/wp/v2/pages/${pageId}`, {
      content: updatedContent
    }, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64')}`,
        'Content-Type': 'application/json'
      }
    });
    return { success: true, data: response.data, alreadyExists: false };
  } catch (error) {
    console.error('Error updating page:', error.response ? error.response.data : error.message);
    return { success: false, message: error.response ? error.response.data.message : error.message };
  }
};

const updatePageTwoWithPDF = async (pageId, newPdfLink, pdfTitle) => {
  try {
    // Fetch the current page content
    const pageContentResult = await getPageContent(pageId);
    if (!pageContentResult.success) {
      return { success: false, message: pageContentResult.message };
    }

    // Create the new content
    const newContent = `
    [pdf-embedder url="${newPdfLink}"]
    [real3dflipbook id="${real3dflipbookId}"]
    `;

    // Update the page content
    const response = await axios.post(`https://www.canadasabeel.com/wp-json/wp/v2/pages/${pageId}`, {
      content: newContent
    }, {
      headers: {
        'Authorization': `Basic ${Buffer.from(`${WP_USERNAME}:${WP_APP_PASSWORD}`).toString('base64')}`,
        'Content-Type': 'application/json'
      }
    });

    return { success: true };
  } catch (error) {
    console.error('Error updating page:', error.response ? error.response.data : error.message);
    return { success: false, message: error.response ? error.response.data.message : error.message };
  }
};

const addToFlipbook = async (pdfUrl, title, retries = 0) => {
  let browser;
  try {
    console.log('Launching browser...');
    
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions'
      ]
    };

    // Log the launch options for debugging
    console.log('Launch options:', JSON.stringify(launchOptions, null, 2));

    browser = await puppeteer.launch(launchOptions);
    console.log('Browser launched successfully');

    const page = await browser.newPage();
    const FLIPBOOK_ID = generateFlipbookId();

    // Set longer timeouts for navigation
    page.setDefaultNavigationTimeout(60000); // 60 seconds
    page.setDefaultTimeout(60000);

    console.log('Navigating to WordPress login...');
    await page.goto('https://www.canadasabeel.com/wp-login.php', {
      waitUntil: 'networkidle0',
      timeout: 60000
    });

    // Add a delay before typing
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log('Logging in...');
    await page.type('#user_login', WP_USERNAME, { delay: 100 });
    await page.type('#user_pass', WP_PASSWORD_LOGIN, { delay: 100 });
    
    await Promise.all([
      page.click('#wp-submit'),
      page.waitForNavigation({ waitUntil: 'networkidle0' })
    ]);
    
    console.log('Successfully logged in');

    await page.goto('https://www.canadasabeel.com/wp-admin/admin.php?page=real3d_flipbook_admin', {
      waitUntil: 'networkidle0'
    });
    
    const flipbookExists = await page.evaluate((title) => {
      const rows = document.querySelectorAll('#the-list tr');
      for (let row of rows) {
        if (row.textContent.includes(title)) {
          return true;
        }
      }
      return false;
    }, title);

    if (flipbookExists) {
      console.log('Flipbook already exists. Skipping flipbook creation.');
      await browser.close();
      return { success: true, message: 'Flipbook already exists. Skipping flipbook creation.', alreadyExists: true };
    }

    await page.goto(`https://www.canadasabeel.com/wp-admin/admin.php?page=real3d_flipbook_admin&action=add_new#pages`, {
      waitUntil: 'networkidle0'
    });
    
    console.log('On flipbook page');

    // Wait for title input to be available
    await page.waitForSelector('#titlewrap input');
    const real3dflipbookInput = await page.$eval('#titlewrap input', (input) => input.value);
    real3dflipbookId = real3dflipbookInput.replace(/\D/g, '');

    // Wait for PDF URL input and type the URL
    await page.waitForSelector('input[name="pdfUrl"]');
    await page.type('input[name="pdfUrl"]', pdfUrl);
    
    console.log('Filled flipbook details');
    
    // Add delay before submitting
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    await page.click('input[name="btbsubmit"][value="Publish"]');
    console.log('Submitted flipbook');

    // Wait for success notice
    await page.waitForSelector('.notice-info', { timeout: 30000 });

    await browser.close();
    return { 
      success: true, 
      message: 'PDF added to flipbook successfully', 
      flipbookId: FLIPBOOK_ID,
      alreadyExists: false 
    };

  } catch (error) {
    console.error('Error in flipbook process:', error);
    
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
    }

    if (retries > 0) {
      console.log(`Retrying... (${retries} attempts left)`);
      return addToFlipbook(pdfUrl, title, retries - 1);
    }

    throw error;
  }
};

const addToPostsAndFlipbook = async (pdfUrl, title, oldPDF) => {
  const pageUpdateResult = await updatePageOneWithPDF(WP_PAGE_1_ID, oldPDF.url, oldPDF.name);
  const addToFlipbookResult = await addToFlipbook(pdfUrl, title);
  const pageTwoUpdateResult = await updatePageTwoWithPDF(WP_PAGE_2_ID, pdfUrl);


  return { 
    success: true, 
    data: { 
      pageUpdate: !pageUpdateResult.alreadyExists,
      pageTwoUpdate: !pageTwoUpdateResult.alreadyExists,
      flipbookCreation: !addToFlipbookResult.alreadyExists
    },
    message: `File processed. Page update: ${pageUpdateResult.alreadyExists ? 'Skipped (already exists)' : 'Updated'}. Flipbook: ${addToFlipbookResult.alreadyExists ? 'Skipped (already exists)' : 'Created'}.`
  };
};

app.use(express.static(__dirname));

// Update the upload endpoint to use authentication
app.post('/upload', checkAuth, upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ message: 'No file uploaded.' });
  }

  try {
    const result = await uploadPDF(file.path, file.originalname);

    // Clean up uploaded file
    fs.unlinkSync(file.path);

    if (result.success) {
      const pdfUrl = result.alreadyExists ? 
          await getPdfUrl(file.originalname) : 
          result.data.source_url;
      
      const OldPdfUrl = await getOldPdf(WP_PAGE_2_ID);
      const uploadResult = await addToPostsAndFlipbook(pdfUrl, file.originalname, OldPdfUrl);
      
      if (uploadResult.success) {
          uploadResult.data.fileUpload = !result.alreadyExists;
          return res.json(uploadResult);
      } else {
          return res.status(500).json({ message: uploadResult.message });
      }
  } else {
      return res.status(500).json({ message: result.message });
  }
  } catch (error) {
    // Clean up uploaded file in case of error
    if (fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
    return res.status(500).json({
      message: 'An error occurred while processing the file.',
      error: error.message
    });
  }
});

// Logout endpoint
app.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ message: 'Error logging out' });
    }
    res.json({ message: 'Logged out successfully' });
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
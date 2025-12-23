// backend/index.js
import express from 'express';
import cors from 'cors';
import { GoogleGenerativeAI } from '@google/generative-ai';
import 'dotenv/config';
import multer from 'multer';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

const app = express();
const port = process.env.PORT || 3000;
const whitelist = [
    "http://localhost:5173",
  "https://skillscope-ai.vercel.app/",
  "",
];

// --- Middlewares ---
app.use(cors());
app.use(express.json());
const corsOptions = {
  origin: whitelist,
  credentials: true, // Required for cookies to be sent
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"], // Ensure headers are properly set
};
app.use(cors(corsOptions));

// --- Gemini AI Setup ---
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY environment variable is not set.");
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// --- Multer Setup for File Uploads ---
// Store files in memory instead of on disk
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB file size limit
});

// --- Helper Functions ---

/**
 * Extracts a JSON object from a string that might be wrapped in markdown.
 */
function extractJson(str) {
    const jsonRegex = /```json\s*([\s\S]*?)\s*```/;
    const match = str.match(jsonRegex);
    if (match && match[1]) {
        try {
            return JSON.parse(match[1]);
        } catch (error) {
            console.error("Failed to parse extracted JSON:", error);
            return null;
        }
    } else {
        try {
            return JSON.parse(str);
        } catch (error) {
            console.error("String is not a valid JSON object:", error);
            return null;
        }
    }
}

/**
 * Analyzes text using the Gemini API and returns structured JSON.
 * @param {string} textToAnalyze The text from the resume.
 * @returns {object | null} The parsed analysis object or null on failure.
 */
async function analyzeResumeText(textToAnalyze) {
    const prompt = `
        Analyze the resume text provided below. Based on the skills and experience, perform the following tasks:
        1.  Identify the user's key skills.
        2.  Suggest three relevant, in-demand job titles.
        3.  For each job title, list the key required skills.
        4.  Compare the user's skills with the job requirements to find the missing skills for each job.
        5.  For each missing skill, recommend one specific online course from Coursera or Udemy, including the course name and a direct URL.

        Return the output ONLY as a single, valid JSON object, enclosed in \`\`\`json ... \`\`\`. Do not include any introductory text or explanations outside of the JSON block.

        The JSON structure must be:
        {
          "userSkills": ["Skill 1", "Skill 2"],
          "jobSuggestions": [
            {
              "title": "Job Title 1",
              "requiredSkills": ["Skill A", "Skill B", "Skill C"],
              "missingSkills": [
                {
                  "skill": "Skill C",
                  "recommendation": {
                    "course": "Course Name for Skill C",
                    "url": "https://www.coursera.org/..."
                  }
                }
              ]
            }
          ]
        }

        --- Resume Text ---
        ${textToAnalyze}
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = result.response;
        const text = response.text();
        // console.log("Gemini API Raw Response:", text);
        return extractJson(text);
    } catch (error) {
        console.error("Error calling Gemini API:", error);
        return null;
    }
}


// --- API Endpoints ---

// Endpoint for analyzing raw text
app.post('/api/analyze-text', async (req, res) => {
    const { resumeText } = req.body;
    if (!resumeText) {
        return res.status(400).json({ error: 'Resume text is required' });
    }

    const analysisResult = await analyzeResumeText(resumeText);

    if (!analysisResult) {
        return res.status(500).json({ error: 'Failed to analyze resume from text.' });
    }
    res.json({ analysis: analysisResult });
});

// Endpoint for analyzing an uploaded file
app.post('/api/analyze-file', upload.single('resume'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded.' });
    }

    let text = '';
    try {
        if (req.file.mimetype === "application/pdf") {
            const data = await pdf(req.file.buffer);
            text = data.text;
        } else if (req.file.mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
            const { value } = await mammoth.extractRawText({ buffer: req.file.buffer });
            text = value;
        } else {
            return res.status(400).json({ error: 'Unsupported file type. Please upload a PDF or DOCX file.' });
        }

        if (!text) {
             return res.status(500).json({ error: 'Failed to extract text from the file.' });
        }

        const analysisResult = await analyzeResumeText(text);

        if (!analysisResult) {
            return res.status(500).json({ error: 'Failed to analyze resume from file.' });
        }
        res.json({ analysis: analysisResult });

    } catch (error) {
        console.error("Error in file processing endpoint:", error);
        res.status(500).json({ error: 'An internal server error occurred.' });
    }
});


app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});

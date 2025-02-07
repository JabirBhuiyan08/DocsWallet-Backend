const express = require('express');
const cors = require('cors');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const path = require('path');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Cloudinary Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Multer Configuration for Temporary Storage
const storage = multer.diskStorage({});
const upload = multer({ storage });


// MongoDB Connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.2d7wy.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

// JWT Verification Middleware
const verifyToken = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ error: true, message: 'Unauthorized access' });
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ error: true, message: 'Unauthorized access' });
    }
    req.decoded = decoded; // Attach decoded token to request
    next();
  });
};

// MongoDB Collections
let db, userCollection, imageCollection, blogCollection;

async function run() {
  try {
    await client.connect();
    db = client.db('docs-wallet');
    userCollection = db.collection('users');
    imageCollection = db.collection('images');
    blogCollection = db.collection('blogs');
    WorksCollection = db.collection('works');

    console.log('Connected to MongoDB.');

    //Works Related Api
    app.post('/works',verifyToken, async (req, res) => {
      const work = req.body;
      const result = await WorksCollection.insertOne(work);
      res.send(result);
    });
    
    app.get('/works', verifyToken, async(req,res)=>{
      const {email} = req.decoded;
      const works = await WorksCollection.find({email}).toArray();
      res.send(works);
    })
    
    app.delete('/works/:id', verifyToken, async (req, res) => {
      const {email}= req.decoded;
      const result = await WorksCollection.deleteOne({email});
      res.send(result);
    });




    // Routes
    app.get('/', (req, res) => {
      res.send('Docs Wallet is running.');
    });

    // JWT Token Generation
    app.post('/jwt', (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
      res.send({ token });
    });

    // User APIs
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existingUser = await userCollection.findOne({ email: user.email });
      if (existingUser) {
        return res.send({ message: 'User already exists' });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    app.get('/user', verifyToken, async (req, res) => {
      const email = req.decoded.email;
      const user = await userCollection.findOne({ email });
      if (!user) {
        return res.status(404).send({ error: true, message: 'User not found' });
      }
      res.send(user);
    });

    // Image Upload API
    app.post('/images', verifyToken, upload.array('files'), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).send({ error: true, message: 'No files uploaded.' });
    }

    console.log('Files received:', files); // Add this log to check files

    // Upload files to Cloudinary and save metadata
    const uploadPromises = files.map((file) =>
      cloudinary.uploader.upload(file.path, {
        folder: 'docs-wallet',
      })
    );
    const results = await Promise.all(uploadPromises);

    console.log('Cloudinary upload results:', results); // Check Cloudinary results

    // Save metadata to MongoDB
    const metadata = results.map((result) => ({
      url: result.secure_url,
      public_id: result.public_id,
      user: req.decoded.email,
      uploadedAt: new Date(),
    }));
    const dbResult = await imageCollection.insertMany(metadata);

    res.status(201).send({
      message: 'Images uploaded successfully.',
      metadataIds: dbResult.insertedIds,
    });
  } catch (error) {
    console.error('Error uploading files:', error);
    res.status(500).send({ error: true, message: 'Failed to upload files.' });
  }
});    

    

    // Fetch Images for Authenticated User
    app.get('/images', verifyToken, async (req, res) => {
      try {
        const userEmail = req.decoded.email;
        const images = await imageCollection.find({ user: userEmail }).toArray();
        res.send(images);
      } catch (error) {
        console.error('Error fetching images:', error);
        res.status(500).send({ error: true, message: 'Failed to fetch images.' });
      }
    });

    // Delete Image API
    app.delete('/images/:id', async (req, res) => {
      try {
        const { id } = req.params;
        const image = await imageCollection.findOne({ _id: new ObjectId(id) });
    
        if (!image) {
          return res.status(404).send({ error: true, message: 'Image not found.' });
        }
    
        console.log('Deleting image:', image);
    
        // Delete from Cloudinary
        const deletionResult = await cloudinary.uploader.destroy(image.public_id);
        if (deletionResult.result !== 'ok') {
          console.error('Failed to delete image from Cloudinary:', deletionResult);
          return res.status(500).send({ error: true, message: 'Failed to delete image from Cloudinary.' });
        }
    
        // Delete from MongoDB
        const dbResult = await imageCollection.deleteOne({ _id: new ObjectId(id) });
        if (dbResult.deletedCount === 0) {
          return res.status(404).send({ error: true, message: 'Image metadata not found in database.' });
        }
    
        res.send({ message: 'Image deleted successfully.' });
      } catch (error) {
        console.error('Error deleting image:', error);
        res.status(500).send({ error: true, message: 'Failed to delete image.' });
      }
    });
    

    app.listen(port, () => {
      console.log(`Docs Wallet is running on port ${port}`);
    });
  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
  }
}

run().catch(console.dir);

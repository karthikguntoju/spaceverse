# Spaceverse Final 🚀

An interactive 3D educational platform for exploring our Solar System with authentication, quizzes, and user reviews.

## Features ✨

- **🌍 3D Solar System Explorer**: Interactive 3D models of all planets with realistic textures and orbital mechanics
- **🔐 User Authentication**: Secure registration and login system with session management
- **🧠 Interactive Quiz System**: Educational quizzes about each planet with score tracking
- **⭐ Review System**: Users can rate and review their experience with the platform
- **📱 Responsive Design**: Works seamlessly across desktop and mobile devices
- **🎵 Immersive Audio**: Background music for enhanced user experience

## Technologies Used 🛠️

- **Backend**: Node.js, Express.js
- **Database**: MongoDB with Mongoose ODM
- **Authentication**: Express-session, bcryptjs
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **3D Graphics**: Three.js for 3D planet models and animations
- **Security**: Rate limiting, input validation, profanity filtering

## Installation & Setup 🔧

1. **Clone the repository**
   ```bash
   git clone https://github.com/karthikguntoju/spaceverse
   cd Spaceverse_final
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   - Copy `.env.example` to `.env`
   - Add your MongoDB connection string to `MONGODB_URI` in `.env`

4. **Start the application**
   ```bash
   npm start
   ```

5. **Access the application**
   - Open your browser and navigate to `http://localhost:5000` or `http://localhost:5001`

## Project Structure 📁

```
Spaceverse_final/
├── config/
│   └── auth.js              # Authentication middleware
├── models/
│   └── review.js            # Review data model
├── routes/
│   └── reviews.js           # Review API routes
├── views/
│   ├── home.html            # Landing page with auth
│   ├── about.html           # About page with reviews
│   ├── solar-system.html    # 3D solar system explorer
│   └── quiz.html            # Interactive quiz system
├── public/
│   ├── textures/            # Planet textures
│   ├── markers/             # AR markers
│   └── audio/               # Background music
├── images/                  # Planet images
├── models/                  # 3D planet models (.glb files)
├── app-enhanced.js          # Main application server
└── package.json             # Project dependencies
```

## Features in Detail 🌟

### 3D Solar System Explorer
- Realistic planet models with accurate textures
- Interactive orbital mechanics
- Click on planets for detailed information
- Smooth camera controls and navigation

### Authentication System
- Secure user registration and login
- Session-based authentication
- Password hashing with bcryptjs
- Protected routes for authenticated users

### Quiz System
- Planet-specific quiz questions
- Score tracking and progress saving
- Multiple choice questions with instant feedback
- Educational content for all age groups

### Review System
- Star rating system (1-5 stars)
- Comment submission with profanity filtering
- User authentication required for reviews
- Real-time review display

## API Endpoints 🔌

- `POST /api/register` - User registration
- `POST /api/login` - User login
- `POST /api/logout` - User logout
- `GET /api/user` - Get current user status
- `GET /api/reviews` - Get all approved reviews
- `POST /api/reviews` - Submit a new review (authenticated)
- `GET /api/planets` - Get planet data
- `GET /api/ephemeris` - Get current planet positions

## Contributing 🤝

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License 📄

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Team 👥

-**Karthik Guntoju** 
- **Priyanshu Kumar** 
- **K. Harshitha** 

## Acknowledgments 🙏

- NASA for planetary data and textures
- Three.js community for 3D graphics support
- MongoDB for database solutions
- Express.js for web framework

---

**🌌 Explore the cosmos with Spaceverse - Where learning meets adventure!**
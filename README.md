# WeFixIt - Business Management Application

A comprehensive web-based business management system for plumbing services, built with Node.js, Express.js, MySQL, and EJS templating.

## 🏗️ Features

### 👥 User Management
- **Multi-role System**: Customer, Admin, and Plumber roles
- **User Registration**: Separate registration for customers and plumbers
- **Profile Management**: Edit personal information and upload profile pictures
- **Authentication**: Secure login/logout system with session management

### 📅 Booking System
- **Service Booking**: Customers can book Installation or Fix services
- **Date Restrictions**: Only current and future dates allowed
- **Booking Management**: View, edit, and cancel bookings
- **Status Tracking**: NEW, ASSIGNED, IN_PROGRESS, COMPLETED, CANCELLED, DECLINED

### 🎯 Dashboard Features

#### Customer Dashboard
- **My Bookings**: View all personal bookings with search and filter
- **Booking Actions**: Edit booking details and cancel bookings
- **Profile Management**: Update personal information and profile picture
- **Real-time Updates**: AJAX-powered interface for seamless interactions

#### Admin Dashboard
- **User Management**: Manage customers and plumbers
- **Booking Management**: View all bookings, assign plumbers, decline bookings
- **Dashboard Analytics**: Statistics and insights
- **Search & Filter**: Advanced filtering capabilities

#### Plumber Dashboard
- **My Bookings**: View assigned bookings
- **Status Updates**: Mark bookings as complete
- **Profile Management**: Update personal information

### 📊 Analytics & Statistics
- **Booking Statistics**: Total, completed, pending, and cancelled bookings
- **User Statistics**: Customer and plumber counts
- **Real-time Data**: Live updates from database

### 🎨 User Interface
- **Responsive Design**: Works on desktop, tablet, and mobile
- **Modern UI**: Clean, professional interface with card-based layouts
- **Interactive Elements**: Modals, forms, and dynamic content
- **Profile Pictures**: Upload and manage profile images

## 🛠️ Technology Stack

### Backend
- **Node.js**: JavaScript runtime environment
- **Express.js**: Web application framework
- **MySQL**: Relational database
- **Multer**: File upload handling
- **Express Session**: Session management

### Frontend
- **EJS**: Embedded JavaScript templating
- **Bootstrap**: CSS framework for responsive design
- **Font Awesome**: Icon library
- **Custom CSS**: Tailored styling for application

### Database
- **MySQL**: Primary database
- **Tables**: users, bookings, and related schemas

## 📋 Prerequisites

Before running this application, make sure you have:

- **Node.js** (v14 or higher)
- **MySQL** (v8.0 or higher)
- **npm** (Node Package Manager)

## 🚀 Installation

### 1. Clone the Repository
```bash
git clone <repository-url>
cd Bussiness_Management_App
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Database Setup
Create a MySQL database and update the connection settings in `database/connection.js`:

```javascript
const mysql = require('mysql2');
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'your_username',
  password: 'your_password',
  database: 'your_database_name'
});
```

### 4. Database Schema
Run the following SQL to create the required tables:

```sql
-- Users table
CREATE TABLE users (
  idusers INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  surname VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  usertype INT NOT NULL, -- 1=Customer, 2=Admin, 3=Plumber
  phone VARCHAR(20) NULL,
  address TEXT NULL,
  profile_picture VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Bookings table
CREATE TABLE bookings (
  idbookings INT PRIMARY KEY AUTO_INCREMENT,
  idUser INT NOT NULL,
  idPlumber INT NULL,
  type VARCHAR(50) NOT NULL,
  date_start DATE NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'NEW',
  before_photo VARCHAR(255) NULL,
  after_photo VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (idUser) REFERENCES users(idusers),
  FOREIGN KEY (idPlumber) REFERENCES users(idusers)
);
```

### 5. Start the Application
```bash
npm start
```

The application will be available at `http://localhost:3000`

## 📁 Project Structure

```
Bussiness_Management_App/
├── app.js                          # Main application file
├── package.json                    # Dependencies and scripts
├── database/
│   └── connection.js              # Database connection
├── routes/
│   ├── admin.js                   # Admin routes
│   ├── booking.js                 # Booking routes
│   ├── customer.js                # Customer routes
│   ├── index.js                   # Main routes
│   ├── login.js                   # Authentication routes
│   ├── plumber.js                 # Plumber routes
│   ├── profile.js                 # Profile routes
│   ├── register.js                # Registration routes
│   └── users.js                   # User management routes
├── views/
│   ├── partials/
│   │   ├── head.ejs              # Navigation header
│   │   └── footer.ejs            # Footer component
│   ├── admindashboard.ejs        # Admin dashboard
│   ├── booking.ejs               # Booking form
│   ├── bookings.ejs              # Admin bookings view
│   ├── mybookings.ejs            # Customer bookings view
│   ├── profile.ejs               # Profile page
│   └── ...                       # Other view files
├── public/
│   ├── stylesheets/
│   │   ├── custom.css            # Custom styles
│   │   └── ...                   # Other CSS files
│   ├── javascripts/
│   │   ├── admin-dashboard.js    # Admin dashboard scripts
│   │   └── ...                   # Other JS files
│   ├── images/                   # Static images
│   └── uploads/
│       └── profile-pictures/     # Profile picture uploads
└── bin/
    └── www                       # Application entry point
```

## 👤 User Roles

### Customer (usertype: 1)
- Book plumbing services
- View and manage personal bookings
- Edit booking details
- Cancel bookings
- Update profile information
- Upload profile pictures

### Admin (usertype: 2)
- Manage all users (customers and plumbers)
- View all bookings
- Assign plumbers to bookings
- Decline bookings
- View dashboard analytics
- Manage system settings

### Plumber (usertype: 3)
- View assigned bookings
- Update booking status
- Mark bookings as complete
- Manage personal profile

## 🔧 Configuration

### Environment Variables
Create a `.env` file in the root directory:

```env
DB_HOST=localhost
DB_USER=your_username
DB_PASSWORD=your_password
DB_NAME=your_database_name
SESSION_SECRET=your_session_secret
PORT=3000
```

### File Upload Settings
Profile pictures are stored in `public/uploads/profile-pictures/` with:
- Maximum file size: 5MB
- Allowed formats: JPEG, JPG, PNG, GIF
- Automatic directory creation

## 🚀 Usage

### Starting the Application
```bash
# Development mode
npm start

# With nodemon for auto-restart
npx nodemon
```

### Accessing the Application
1. Open your browser and navigate to `http://localhost:3000`
2. Register as a customer or plumber
3. Login with your credentials
4. Access role-specific features

## 🔒 Security Features

- **Session Management**: Secure user sessions
- **Input Validation**: Server-side validation for all forms
- **File Upload Security**: Restricted file types and sizes
- **SQL Injection Protection**: Parameterized queries
- **Authentication**: Protected routes for logged-in users

## 📱 Responsive Design

The application is fully responsive and works on:
- Desktop computers
- Tablets
- Mobile phones

## 🛠️ Development

### Adding New Features
1. Create route files in `routes/` directory
2. Add view files in `views/` directory
3. Update CSS in `public/stylesheets/custom.css`
4. Add JavaScript files in `public/javascripts/`

### Database Changes
1. Update the database schema
2. Modify connection queries in route files
3. Update view templates to reflect changes

## 🐛 Troubleshooting

### Common Issues

**Database Connection Error**
- Verify MySQL is running
- Check connection credentials in `database/connection.js`
- Ensure database exists

**File Upload Issues**
- Check directory permissions for `public/uploads/`
- Verify file size limits
- Ensure allowed file types

**Session Issues**
- Clear browser cookies
- Restart the application
- Check session configuration

## 📄 License

This project is licensed under the MIT License.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📞 Support

For support and questions:
- Create an issue in the repository
- Contact the development team
- Check the documentation

---

**WeFixIt** - Making plumbing services management simple and efficient! 🛠️ 
# Odette Trollbox Admin Interface Setup

## Overview

The Trollbox Admin Interface provides secure administrative controls for the Odette trollbox chat system, including:

- 🔐 Password-protected admin authentication
- 📢 Admin message broadcasting (appears as "Admin" in trollbox)
- 🗑️ Message deletion capabilities
- 📊 Real-time statistics dashboard
- 🔍 Message filtering and search tools

## Files Added/Modified

### New Files:
- `trollbox-admin.html` - Admin interface HTML
- `trollbox-admin.js` - Admin functionality JavaScript
- `firebase-rules.txt` - Firebase security rules
- `TROLLBOX_ADMIN_SETUP.md` - This setup guide

### Modified Files:
- `trollbox.js` - Added admin message support
- `app.html` - Added admin message CSS styles

## Setup Instructions

### 1. Firebase Rules Configuration

1. Open your Firebase Console
2. Navigate to Firestore Database > Rules
3. Replace the existing rules with the content from `firebase-rules.txt`
4. **Important**: Change the admin password hash in the rules:
   - Current hash is for password "admin123"
   - Generate a new SHA-256 hash for your secure password
   - Replace the hash in the `isValidAdminPassword` function

### 2. Generate Admin Password Hash

To create a new admin password hash:

```javascript
// Run this in browser console to generate hash for your password
async function hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Replace "your-secure-password" with your actual admin password
hashPassword("your-secure-password").then(hash => console.log(hash));
```

### 3. Deploy Files

1. Upload all files to your web server
2. Ensure `trollbox-admin.html` is accessible (e.g., `https://yourdomain.com/trollbox-admin.html`)
3. Test that the regular trollbox is working first

### 4. Access Admin Interface

1. Navigate to `trollbox-admin.html`
2. Enter the admin password (default: "admin123" - **change this!**)
3. You should see the admin dashboard after successful login

## Usage Guide

### Admin Authentication

- **Login**: Enter admin password to access dashboard
- **Session**: Stays logged in for 1 hour, then requires re-authentication
- **Logout**: Click logout button to end session immediately

### Sending Admin Messages

1. Use the "Send Admin Message" section in the dashboard
2. Type your message (up to 500 characters for admins vs 200 for users)
3. Click "Send as Admin" or press Enter
4. Message appears in trollbox with orange "Admin" styling and shield badge
5. Admin messages bypass normal content filters

### Message Management

1. **View Messages**: See all trollbox messages with filtering options
2. **Filter by Type**: All, User messages, or Admin messages only
3. **Time Filter**: Last 24h, 7 days, 30 days, or all time
4. **Search**: Text search across message content and authors
5. **Delete Messages**: Click trash icon next to any message
6. **Pagination**: Navigate through message history

### Statistics Dashboard

Real-time stats include:
- Total messages count
- Currently online users
- Messages sent today
- Total admin messages

## Security Features

### Password Protection
- SHA-256 hashed password validation
- Server-side validation via Firebase rules
- Session tokens with expiration
- No password storage in browser

### Admin Message Security
- Special `isAdmin` flag in message data
- Admin token validation for all admin operations
- Server-side content length validation (500 char limit for admins)
- Audit logging of admin actions

### Message Deletion
- Admin-only operation
- Audit trail in `admin_actions` collection
- Immediate removal from trollbox
- Cannot be undone (implement backup if needed)

## Customization

### Styling
Admin message styles are in `app.html`:
```css
.trollbox-messages .message.admin-message {
    background: rgba(255, 167, 38, 0.1);
    border-left: 3px solid #ffa726;
}
```

### Admin Password
Update in both:
1. `firebase-rules.txt` - `isValidAdminPassword` function
2. `trollbox-admin.js` - `adminPasswordHash` property

### Message Limits
- User messages: 200 characters (configurable in `TROLLBOX_CONTENT_RULES`)
- Admin messages: 500 characters (configurable in Firebase rules)

## Troubleshooting

### Common Issues

**"Permission denied" on login:**
- Check Firebase rules are deployed correctly
- Verify password hash matches in rules and admin.js
- Check browser console for detailed error messages

**Admin messages not appearing:**
- Verify trollbox.js has admin message display code
- Check CSS styles are loaded
- Confirm Firebase rules allow admin message creation

**Statistics not loading:**
- Verify Firebase project has necessary collections
- Check browser console for database permission errors
- Ensure presence system is working in main trollbox

**Message deletion fails:**
- Confirm admin is properly authenticated
- Check Firebase rules allow message deletion
- Verify message ID exists in database

### Debug Tools

The admin interface includes debug logging. Check browser console for:
- `🔧 Initializing Trollbox Admin...`
- `🔥 Firebase available from trollbox.js`
- `✅ Trollbox Admin initialized`

## Production Considerations

### Security Hardening
1. **Change default password** immediately
2. **Use HTTPS** for admin interface
3. **Implement IP restrictions** if needed
4. **Add rate limiting** for admin actions
5. **Set up monitoring** for admin activities

### Backup Strategy
- Consider backing up messages before allowing deletion
- Implement soft delete with restoration capability
- Log all admin actions with timestamps

### Scaling
- For high-traffic trollboxes, implement pagination for message list
- Consider caching statistics for better performance
- Add database indexes for common queries

## Support

For issues with the admin interface:
1. Check browser console for error messages
2. Verify Firebase rules are correctly deployed
3. Test with a fresh browser session
4. Check network requests in browser dev tools

The admin interface integrates seamlessly with the existing trollbox system and provides powerful moderation tools while maintaining security and user experience. 
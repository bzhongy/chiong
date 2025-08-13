# Chiong - DeFi Options Trading Interface

A modern, responsive web application for trading zero-day options on the Thetanuts Options Protocol.

## 🚀 Features

- **Zero-Day Options Trading**: Trade options that expire daily at 8:00 UTC
- **Real-Time Charts**: Integrated TradingView charts with custom analytics
- **Web3 Integration**: Support for MetaMask, WalletConnect, and in-browser wallets
- **Mobile Responsive**: Optimized for both desktop and mobile devices
- **Live Chat**: Integrated trollbox for community interaction
- **Price Alerts**: Set custom price notifications
- **Transaction Notifications**: Real-time transaction status updates

## 🏗️ Architecture

This is a **static web application** built with:
- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **UI Framework**: Bootstrap 5.2.3
- **Charts**: TradingView, Chart.js
- **Web3**: Ethers.js
- **Styling**: Custom CSS with modern design principles

## 🚀 Quick Start

### Prerequisites
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Web3 wallet (MetaMask, WalletConnect, or use in-browser wallet)

### Local Development

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd chiong
   ```

2. **Serve the application**
   
   **Option A: Python HTTP Server**
   ```bash
   python3 -m http.server 8000
   ```
   
   **Option B: Node.js HTTP Server**
   ```bash
   npx http-server -p 8000
   ```
   
   **Option C: PHP Built-in Server**
   ```bash
   php -S localhost:8000
   ```

3. **Open your browser**
   Navigate to `http://localhost:8000`

## 📁 Project Structure

```
chiong/
├── index.html          # Landing page
├── app.html           # Main trading application
├── app.js             # Core application logic
├── app.css            # Main stylesheet
├── config.js          # Configuration settings
├── wallet.js          # Wallet integration
├── ui_interactions.js # UI event handlers
├── analytics.js       # Analytics and tracking
├── trollbox.js        # Chat functionality
├── tx-notifications.js # Transaction notifications
├── img/               # Images and assets
├── analysis/          # Analytics components
└── README.md          # This file
```

## 🔧 Configuration

The application can be configured through `config.js`:
- Network settings
- API endpoints
- Default parameters
- Feature toggles

## 🌐 Supported Networks

- Ethereum Mainnet
- Polygon
- Arbitrum
- Optimism
- BSC

## 💰 Supported Assets

- **Cryptocurrencies**: BTC, ETH, SOL, AVAX, and more
- **Option Types**: Call and Put options
- **Expiry**: Daily at 8:00 UTC

## 🔒 Security

- Client-side wallet integration
- No private key storage
- Secure Web3 connections
- Transaction signing through user's wallet

## 📱 Mobile Support

- Responsive design for all screen sizes
- Touch-optimized interface
- Mobile-first navigation
- Progressive Web App features

## 🚀 Deployment

### Static Hosting
Deploy to any static hosting service:
- Netlify
- Vercel
- GitHub Pages
- AWS S3 + CloudFront
- Firebase Hosting

### Build Process
No build process required - this is a pure static application.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- **Thetanuts Finance** for the underlying options protocol
- **Bootstrap** for the UI framework
- **TradingView** for charting capabilities
- **Ethers.js** for Web3 integration

## 📞 Support

- **Documentation**: [docs.chiong.fi](https://docs.chiong.fi)
- **Community**: Join our Discord/Telegram
- **Issues**: Report bugs via GitHub Issues

---

Built with ❤️ by the Chiong team

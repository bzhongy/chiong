// Time Decay Visualization using p5.js
let sketch = function(p) {
    // Canvas dimensions
    let width, height;
    
    // Option parameters
    let strikePrice = 2350;
    let currentPrice = 2345;
    let initialPremium = 35;
    
    // Time parameters
    let totalHours = 8; // 8 hours until expiry
    let currentHour = 0; // Start at the beginning of the day
    
    // Colors
    let bgColor;
    let gridColor;
    let priceLineColor;
    let strikeLineColor;
    let optionValueColor;
    let timeDecayColor;
    
    // Animation
    let animationSpeed = 0.01; // Hours per frame
    
    p.setup = function() {
        // Get container dimensions
        const container = document.getElementById('time-decay-visualization');
        width = container.offsetWidth;
        height = container.offsetHeight;
        
        // Create canvas
        const canvas = p.createCanvas(width, height);
        canvas.parent('time-decay-visualization');
        
        // Set colors
        bgColor = p.color('#1C2A35');
        gridColor = p.color(96, 125, 139, 50); // Soft slate with transparency
        priceLineColor = p.color('#00B8D4'); // Primary color
        strikeLineColor = p.color('#DFFA4C'); // Accent color
        optionValueColor = p.color('#18F2B2'); // Signal green
        timeDecayColor = p.color('#FF3D71'); // Alert red
        
        // Set text properties
        p.textFont('IBM Plex Mono');
        p.textAlign(p.LEFT, p.CENTER);
    };
    
    p.draw = function() {
        p.background(bgColor);
        
        // Draw grid
        drawGrid();
        
        // Draw price and strike lines
        drawPriceLines();
        
        // Calculate and draw option value curve
        drawOptionValueCurve();
        
        // Draw time decay indicator
        drawTimeDecay();
        
        // Draw legend
        drawLegend();
        
        // Update time
        currentHour += animationSpeed;
        if (currentHour > totalHours) {
            currentHour = 0;
        }
    };
    
    function drawGrid() {
        p.stroke(gridColor);
        p.strokeWeight(1);
        
        // Vertical grid lines (time)
        for (let i = 0; i <= totalHours; i++) {
            let x = p.map(i, 0, totalHours, 80, width - 30);
            p.line(x, 30, x, height - 50);
            
            // Time labels
            p.noStroke();
            p.fill(gridColor);
            p.textSize(10);
            let timeLabel = `${8 - i}h`;
            if (i === 0) timeLabel = 'Expiry';
            if (i === totalHours) timeLabel = 'Now';
            p.text(timeLabel, x - 15, height - 35);
        }
        
        // Horizontal grid lines (price)
        for (let i = 0; i <= 5; i++) {
            let y = p.map(i, 0, 5, height - 50, 30);
            p.line(80, y, width - 30, y);
            
            // Price labels
            p.noStroke();
            p.fill(gridColor);
            p.textSize(10);
            let priceLabel;
            if (i === 0) priceLabel = '$0';
            else if (i === 1) priceLabel = '$20';
            else if (i === 2) priceLabel = '$40';
            else if (i === 3) priceLabel = '$60';
            else if (i === 4) priceLabel = '$80';
            else priceLabel = '$100';
            p.text(priceLabel, 50, y);
        }
        
        // Y-axis label
        p.push();
        p.translate(20, height / 2);
        p.rotate(-p.HALF_PI);
        p.textAlign(p.CENTER, p.CENTER);
        p.text('Option Premium ($)', 0, 0);
        p.pop();
        
        // X-axis label
        p.textAlign(p.CENTER, p.CENTER);
        p.text('Time Until Expiration', width / 2, height - 15);
    }
    
    function drawPriceLines() {
        // Draw strike price line
        p.stroke(strikeLineColor);
        p.strokeWeight(1.5);
        p.drawingContext.setLineDash([5, 5]);
        let strikeY = p.map(strikePrice, 2200, 2500, height - 50, 30);
        p.line(80, strikeY, width - 30, strikeY);
        p.drawingContext.setLineDash([]);
        
        // Strike price label
        p.noStroke();
        p.fill(strikeLineColor);
        p.textSize(12);
        p.text(`Strike: $${strikePrice}`, width - 70, strikeY - 15);
        
        // Draw current price line
        p.stroke(priceLineColor);
        p.strokeWeight(1.5);
        let priceY = p.map(currentPrice, 2200, 2500, height - 50, 30);
        p.line(80, priceY, width - 30, priceY);
        
        // Current price label
        p.noStroke();
        p.fill(priceLineColor);
        p.textSize(12);
        p.text(`Current: $${currentPrice}`, width - 70, priceY + 15);
    }
    
    function drawOptionValueCurve() {
        p.noFill();
        p.stroke(optionValueColor);
        p.strokeWeight(3);
        
        p.beginShape();
        for (let x = 0; x <= width - 110; x++) {
            let timePoint = p.map(x, 0, width - 110, 0, totalHours);
            let timeRemaining = totalHours - timePoint;
            let timeRatio = timeRemaining / totalHours;
            
            // Calculate option value based on time decay
            // This is a simplified model for visualization purposes
            let optionValue = initialPremium * (0.2 + 0.8 * Math.pow(timeRatio, 0.5));
            
            // Add some randomness to simulate market fluctuations
            optionValue += p.sin(timePoint * 0.5) * 2;
            
            let y = p.map(optionValue, 0, 100, height - 50, 30);
            p.vertex(80 + x, y);
        }
        p.endShape();
        
        // Draw current value point
        let currentTimeX = p.map(currentHour, 0, totalHours, 80, width - 30);
        let timeRatio = (totalHours - currentHour) / totalHours;
        let currentOptionValue = initialPremium * (0.2 + 0.8 * Math.pow(timeRatio, 0.5));
        currentOptionValue += p.sin(currentHour * 0.5) * 2;
        let currentValueY = p.map(currentOptionValue, 0, 100, height - 50, 30);
        
        p.fill(optionValueColor);
        p.noStroke();
        p.circle(currentTimeX, currentValueY, 8);
        
        // Current value label
        p.textSize(12);
        p.text(`$${currentOptionValue.toFixed(2)}`, currentTimeX + 15, currentValueY - 10);
    }
    
    function drawTimeDecay() {
        // Draw time decay acceleration curve
        p.noFill();
        p.stroke(timeDecayColor);
        p.strokeWeight(2);
        
        p.beginShape();
        for (let x = 0; x <= width - 110; x++) {
            let timePoint = p.map(x, 0, width - 110, 0, totalHours);
            let timeRemaining = totalHours - timePoint;
            let timeRatio = timeRemaining / totalHours;
            
            // Time decay accelerates as expiry approaches
            let decayRate = 0.2 + 0.8 * Math.pow(1 - timeRatio, 2);
            let y = p.map(decayRate * 100, 0, 100, height - 50, 30);
            p.vertex(80 + x, y);
        }
        p.endShape();
        
        // Draw current decay rate point
        let currentTimeX = p.map(currentHour, 0, totalHours, 80, width - 30);
        let timeRatio = (totalHours - currentHour) / totalHours;
        let currentDecayRate = 0.2 + 0.8 * Math.pow(1 - timeRatio, 2);
        let currentDecayY = p.map(currentDecayRate * 100, 0, 100, height - 50, 30);
        
        p.fill(timeDecayColor);
        p.noStroke();
        p.circle(currentTimeX, currentDecayY, 8);
        
        // Current decay rate label
        if (currentHour > 0.1) {
            p.textSize(12);
            p.text(`${(currentDecayRate * 100).toFixed(1)}% decay/hr`, currentTimeX - 100, currentDecayY - 10);
        }
    }
    
    function drawLegend() {
        p.noStroke();
        p.fill(255);
        p.textSize(14);
        p.textAlign(p.LEFT, p.CENTER);
        
        // Title
        p.fill('#FFFFFF');
        p.textStyle(p.BOLD);
        p.text('0DTE Option Time Decay', 100, 20);
        p.textStyle(p.NORMAL);
        
        // Legend items
        let legendX = 100;
        let legendY = 50;
        
        // Option value
        p.fill(optionValueColor);
        p.rect(legendX, legendY - 5, 15, 10);
        p.fill('#FFFFFF');
        p.text('Option Premium', legendX + 25, legendY);
        
        // Time decay
        p.fill(timeDecayColor);
        p.rect(legendX + 200, legendY - 5, 15, 10);
        p.fill('#FFFFFF');
        p.text('Theta Decay Rate', legendX + 225, legendY);
    }
    
    // Handle window resize
    p.windowResized = function() {
        const container = document.getElementById('time-decay-visualization');
        width = container.offsetWidth;
        height = container.offsetHeight;
        p.resizeCanvas(width, height);
    };
};

// Initialize the sketch when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    new p5(sketch);
}); 
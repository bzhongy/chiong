// Leverage Multiplier Visualization using p5.js
let sketch = function(p) {
    // Canvas dimensions
    let width, height;
    
    // Parameters
    let strikePrice;
    let currentPrice;
    let optionPremium;
    
    // Scenario parameters
    let priceChange = 0; // Current price change being animated
    let maxPriceChange = 50; // Max price change to show (+/-)
    
    // Animation
    let animationSpeed = 0.2; // Price change per frame
    let direction = 1; // 1 for increasing, -1 for decreasing
    
    // Colors
    let bgColor;
    let gridColor;
    let priceLineColor;
    let optionReturnColor;
    let spotReturnColor;
    let strikeLineColor;
    
    p.setup = function() {
        // Get container dimensions
        const container = document.getElementById('leverage-visualization');
        console.log("Container found:", container); // Debug line
        
        if (!container) {
            console.error("Container not found!"); 
            return;
        }
        
        width = container.offsetWidth;
        height = container.offsetHeight;
        
        // Create canvas
        const canvas = p.createCanvas(width, height);
        canvas.parent('leverage-visualization');
        
        // Set colors
        bgColor = p.color('#1C2A35');
        gridColor = p.color(96, 125, 139, 50); // Soft slate with transparency
        priceLineColor = p.color('#00B8D4'); // Primary color
        optionReturnColor = p.color('#DFFA4C'); // Accent color (vivid citron)
        spotReturnColor = p.color('#607D8B'); // Soft slate
        strikeLineColor = p.color('#00B8D4'); // Primary color with transparency
        
        // Set text properties
        p.textFont('IBM Plex Mono');
        p.textAlign(p.LEFT, p.CENTER);
        
        // Adjust initial parameters to show a more realistic scenario
        strikePrice = 2300;
        currentPrice = 2275; // Start further OTM to show leverage properly
        optionPremium = 5; // in dollars
    };
    
    p.draw = function() {
        p.background(bgColor);
        
        // Draw grid
        drawGrid();
        
        // Draw strike line
        drawStrikeLine();
        
        // Draw return comparison
        drawReturnComparison();
        
        // Draw legend
        drawLegend();
        
        // Update animation
        updateAnimation();
    };
    
    function drawGrid() {
        p.stroke(gridColor);
        p.strokeWeight(1);
        
        // Horizontal grid lines (return percentage)
        for (let i = -100; i <= 500; i += 100) {
            let y = p.map(i, -100, 500, height - 40, 40);
            p.line(80, y, width - 30, y);
            
            // Return labels
            p.noStroke();
            p.fill(gridColor);
            p.textSize(10);
            p.text(`${i}%`, 40, y);
        }
        
        // Vertical grid lines (price change)
        for (let i = -60; i <= 60; i += 20) {
            let x = p.map(i, 0, maxPriceChange, 80, width - 30);
            p.line(x, 40, x, height - 40);
            
            // Price change labels
            p.noStroke();
            p.fill(gridColor);
            p.textSize(10);
            p.text(`$${currentPrice + i}`, x - 20, height - 20);
        }
        
        // Zero line
        p.stroke(gridColor);
        p.strokeWeight(1.5);
        let zeroY = p.map(0, -100, 500, height - 40, 40);
        p.line(80, zeroY, width - 30, zeroY);
    }
    
    function drawStrikeLine() {
        // Draw strike price vertical line
        let strikeX = p.map(strikePrice - currentPrice, 0, maxPriceChange, 80, width - 30);
        p.stroke(strikeLineColor);
        p.strokeWeight(1);
        
        // Use manual dashed line instead of setLineDash which isn't available in p5.js
        const dashLength = 5;
        const gapLength = 5;
        for (let y = 40; y < height - 40; y += dashLength + gapLength) {
            const endY = Math.min(y + dashLength, height - 40);
            p.line(strikeX, y, strikeX, endY);
        }
        
        // Strike label
        p.noStroke();
        p.fill(strikeLineColor);
        p.textSize(11);
        p.text(`Strike: $${strikePrice}`, strikeX - 40, 30);
    }
    
    function drawReturnComparison() {
        // Current price point
        let currentX = p.map(priceChange, 0, maxPriceChange, 80, width - 30);
        let newPrice = currentPrice + priceChange;
        
        // Calculate spot return
        let spotReturn = (priceChange / currentPrice) * 100;
        
        // Calculate option return for 0DTE - for 0DTE, we assume cost is fully lost
        // and only count intrinsic value at expiration
        let optionReturn;
        
        if (newPrice >= strikePrice) {
            // In the money - only intrinsic value matters
            let intrinsicValue = newPrice - strikePrice;
            // For 0DTE, option cost is fully lost, we only count intrinsicValue - cost
            optionReturn = ((intrinsicValue - optionPremium) / optionPremium) * 100;
        } else {
            // Out of the money - for 0DTE, option expires worthless
            // Full loss of premium
            optionReturn = -100; // -100% return (complete loss)
        }
        
        // Draw spot return line
        p.stroke(spotReturnColor);
        p.strokeWeight(2);
        p.noFill();
        p.beginShape();
        for (let x = 0; x <= width - 110; x++) {
            let px = p.map(x, 0, width - 110, 0, maxPriceChange);
            let spotRet = (px / currentPrice) * 100;
            let y = p.map(spotRet, -100, 500, height - 40, 40);
            p.vertex(x + 80, y);
        }
        p.endShape();
        
        // Draw option return curve - using the same model as above
        p.stroke(optionReturnColor);
        p.strokeWeight(3);
        p.noFill();
        p.beginShape();
        for (let x = 0; x <= width - 110; x++) {
            let px = p.map(x, 0, width - 110, 0, maxPriceChange);
            let newP = currentPrice + px;
            
            let optRet;
            if (newP >= strikePrice) {
                // In the money - only intrinsic value matters
                let intrinsicValue = newP - strikePrice;
                // Cost is fully lost, only count intrinsic value minus cost
                optRet = ((intrinsicValue - optionPremium) / optionPremium) * 100;
            } else {
                // Out of the money - option expires worthless
                optRet = -100; // -100% return (complete loss)
            }
            
            let y = p.map(optRet, -100, 500, height - 40, 40);
            p.vertex(x + 80, y);
        }
        p.endShape();
        
        // Current point on both curves
        let spotY = p.map(spotReturn, -100, 500, height - 40, 40);
        let optionY = p.map(optionReturn, -100, 500, height - 40, 40);
        
        // Spot point
        p.fill(spotReturnColor);
        p.noStroke();
        p.circle(currentX, spotY, 8);
        
        // Option point
        p.fill(optionReturnColor);
        p.noStroke();
        p.circle(currentX, optionY, 10);
        
        // Current values
        p.textSize(14);
        p.fill(255);
        p.text(`ETH Price: $${(currentPrice + priceChange).toFixed(0)}`, width - 250, 60);
        
        p.fill(spotReturnColor);
        p.text(`Spot Return: ${spotReturn.toFixed(1)}%`, width - 250, 85);
        
        p.fill(optionReturnColor);
        p.text(`Option Return: ${optionReturn.toFixed(1)}%`, width - 250, 110);
        
        // Calculate and display nominal leverage (exposure per dollar)
        // This is how traders typically think of option leverage
        let nominalLeverage = currentPrice / optionPremium;
        
        // Also calculate return-based leverage for comparison
        let returnLeverage = Math.abs(optionReturn / spotReturn);
        if (!isFinite(returnLeverage) || isNaN(returnLeverage)) returnLeverage = 0;
        
        p.fill('#18F2B2'); // Signal green
        p.textSize(16);
        p.textStyle(p.BOLD);
        p.text(`Nominal Leverage: ${nominalLeverage.toFixed(1)}x`, width - 250, 140);
        p.textStyle(p.NORMAL);
        
        // Optionally show return leverage as well if desired
        // p.textSize(14);
        // p.text(`Return Multiplier: ${returnLeverage.toFixed(1)}x`, width - 250, 165);
    }

    function drawLegend() {
        p.noStroke();
        p.fill(255);
        p.textSize(16);
        p.textAlign(p.LEFT, p.CENTER);
        
        // Title
        p.fill('#FFFFFF');
        p.textStyle(p.BOLD);
        p.text('0DTE Option Leverage Effect', 100, 25);
        p.textStyle(p.NORMAL);
        
        // Subtitle
        p.textSize(12);
        p.fill(gridColor);
        p.text('Small price moves, amplified returns', 350, 25);
        
        // Legend items
        let legendX = 100;
        let legendY = 60;
        
        // Option return
        p.fill(optionReturnColor);
        p.rect(legendX, legendY - 5, 15, 10);
        p.fill('#FFFFFF');
        p.textSize(12);
        p.text('$2300 Call Option', legendX + 25, legendY);
        
        // Spot return
        p.fill(spotReturnColor);
        p.rect(legendX + 180, legendY - 5, 15, 10);
        p.fill('#FFFFFF');
        p.text('$2275 ETH Spot', legendX + 205, legendY);
    }
    
    function updateAnimation() {
        // Update price change for animation
        priceChange += animationSpeed * direction;
        
        // Reverse direction when reaching max
        if (priceChange > maxPriceChange || priceChange < 0) {
            direction *= -1;
        }
    }
    
    // Handle window resize
    p.windowResized = function() {
        const container = document.getElementById('leverage-visualization');
        width = container.offsetWidth;
        height = container.offsetHeight;
        p.resizeCanvas(width, height);
    };
};

// Initialize the sketch when the document is ready
document.addEventListener('DOMContentLoaded', function() {
    new p5(sketch);
}); 
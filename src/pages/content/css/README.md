# Danmaku CSS Module System

This folder contains a modular CSS system for the Danmaku extension that allows easy support for multiple video sites.

## File Structure

```
css/
├── danmaku-base.css      # Base styles used across all sites
├── login-modal.css       # Login modal styles (shared across sites)
├── sites/
│   ├── youtube.css       # YouTube-specific styles
│   └── generic.css       # Generic site template
```

## How to Use

### For existing sites:
1. Always include `danmaku-base.css` first
2. Include the site-specific CSS file (e.g., `youtube.css`)
3. Include `login-modal.css` if using the login modal

### For new sites:
1. Copy `generic.css` to a new file named after your site (e.g., `netflix.css`)
2. Modify the CSS variables and selectors to match the target site's design system
3. Test and adjust colors, spacing, and styling to fit the site's aesthetic

## CSS Structure

### Base Styles (`danmaku-base.css`)
- Core danmaku comment rendering
- Base UI component styles
- Cross-site compatible styles with fallback colors

### Site-Specific Styles (`sites/*.css`)
- Override base styles with site-specific theming
- Use the site's CSS variables when available
- Maintain visual consistency with the host site

### Login Modal (`login-modal.css`)
- Shared login modal styling
- Independent of site-specific theming
- Consistent across all sites

## Adding a New Site

1. Create a new CSS file in the `sites/` folder
2. Copy the structure from `generic.css`
3. Replace generic styles with site-specific ones:
   - Use the site's color variables
   - Match the site's border radius and spacing
   - Ensure buttons and inputs fit the site's design language
4. Test the integration thoroughly

## Example Integration

```javascript
// In your site-specific content script
const baseCSS = chrome.runtime.getURL('css/danmaku-base.css');
const siteCSS = chrome.runtime.getURL('css/sites/youtube.css');
const modalCSS = chrome.runtime.getURL('css/login-modal.css');

// Inject CSS files
injectCSS(baseCSS);
injectCSS(siteCSS);
injectCSS(modalCSS);
```

This modular approach makes it easy to:
- Add new sites without touching existing code
- Maintain consistent core functionality
- Customize appearance per site
- Keep CSS organized and maintainable

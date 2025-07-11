# Danmaku CSS Module System

This folder contains a modular CSS system for the Danmaku extension that separates comment rendering from UI controls for better organization and maintainability.

## File Structure

```
css/
├── danmaku.css           # Danmaku comment rendering and visual effects
├── danmaku-input.css     # Danmaku input UI components and controls
├── modal-login.css       # Login modal styles (shared across sites)
├── modal-report.css      # Report modal styles (shared across sites)
├── danmaku-popup.css     # Danmaku popup styles (shared across sites)
├── sites/
│   ├── youtube.css       # YouTube-specific styles
│   └── crunchyroll.css   # Crunchyroll-specific styles
```

## How to Use

### For existing sites:
1. Always include `danmaku.css` and `danmaku-input.css` first
2. Include the site-specific CSS file (e.g., `youtube.css`)
3. Include additional modal CSS files as needed (`modal-login.css`, `modal-report.css`, etc.)

### For new sites:
1. Copy a site-specific CSS file to a new file named after your site (e.g., `netflix.css`)
2. Modify the CSS variables and selectors to match the target site's design system
3. Test and adjust colors, spacing, and styling to fit the site's aesthetic
4. Core styles are split between `danmaku.css` (comment rendering) and `danmaku-input.css` (UI components)

## CSS Structure

### Core Styles
- **danmaku.css**: Comment rendering, positioning, animations, and visual effects
- **danmaku-input.css**: Input interface, controls, style menus, and UI components

### Site-Specific Styles (`sites/*.css`)
- Override core styles with site-specific theming
- Use the site's CSS variables when available
- Maintain visual consistency with the host site

### Additional Styles
- **modal-login.css**: Shared login modal styling, independent of site-specific theming
- **modal-report.css**: Shared report modal styling for reporting danmaku comments
- **danmaku-popup.css**: Shared popup styling for danmaku interaction buttons

## Adding a New Site

1. Create a new CSS file in the `sites/` folder
2. Copy the structure from an existing site CSS file (like `youtube.css` or `crunchyroll.css`)
3. Replace site-specific styles with ones appropriate for your target site:
   - Use the site's color variables
   - Match the site's border radius and spacing
   - Ensure buttons and inputs fit the site's design language
4. Test the integration thoroughly
5. Core styles are automatically included via `danmaku.css` and `danmaku-input.css` - focus only on site-specific customizations

## Example Integration

```javascript
// In your site-specific content script
const danmakuCss = chrome.runtime.getURL('css/danmaku.css');
const danmakuInputCss = chrome.runtime.getURL('css/danmaku-input.css');
const siteCSS = chrome.runtime.getURL('css/sites/youtube.css');
const modalCSS = chrome.runtime.getURL('css/modal-login.css');

// Inject CSS files
injectCSS(danmakuCss);
injectCSS(danmakuInputCss);
injectCSS(siteCSS);
injectCSS(modalCSS);
```

This modular approach makes it easy to:
- Separate comment rendering from UI controls
- Add new sites without touching existing code
- Maintain consistent core functionality
- Customize appearance per site
- Keep CSS organized and maintainable

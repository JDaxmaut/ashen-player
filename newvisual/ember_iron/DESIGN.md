---
name: Ember & Iron
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1c1b1b'
  surface-container: '#20201f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e5e2e1'
  on-surface-variant: '#d3c4af'
  inverse-surface: '#e5e2e1'
  inverse-on-surface: '#313030'
  outline: '#9c8f7b'
  outline-variant: '#4f4535'
  surface-tint: '#f7bd48'
  primary: '#f7bd48'
  on-primary: '#412d00'
  primary-container: '#ba880f'
  on-primary-container: '#392700'
  inverse-primary: '#7b5800'
  secondary: '#ffb5a0'
  on-secondary: '#601400'
  secondary-container: '#ff5625'
  on-secondary-container: '#541100'
  tertiary: '#c8c6c6'
  on-tertiary: '#303030'
  tertiary-container: '#929090'
  on-tertiary-container: '#2a2a2a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffdea6'
  primary-fixed-dim: '#f7bd48'
  on-primary-fixed: '#271900'
  on-primary-fixed-variant: '#5d4200'
  secondary-fixed: '#ffdbd1'
  secondary-fixed-dim: '#ffb5a0'
  on-secondary-fixed: '#3b0900'
  on-secondary-fixed-variant: '#872000'
  tertiary-fixed: '#e4e2e1'
  tertiary-fixed-dim: '#c8c6c6'
  on-tertiary-fixed: '#1b1c1c'
  on-tertiary-fixed-variant: '#474747'
  background: '#131313'
  on-background: '#e5e2e1'
  surface-variant: '#353535'
typography:
  headline-xl:
    fontFamily: Noto Serif
    fontSize: 48px
    fontWeight: '400'
    lineHeight: '1.2'
    letterSpacing: 0.1em
  headline-lg:
    fontFamily: Noto Serif
    fontSize: 32px
    fontWeight: '400'
    lineHeight: '1.3'
    letterSpacing: 0.05em
  body-lg:
    fontFamily: Newsreader
    fontSize: 18px
    fontWeight: '400'
    lineHeight: '1.6'
  body-md:
    fontFamily: Newsreader
    fontSize: 16px
    fontWeight: '400'
    lineHeight: '1.5'
  label-sm:
    fontFamily: Newsreader
    fontSize: 12px
    fontWeight: '600'
    lineHeight: '1.2'
    letterSpacing: 0.2em
spacing:
  base: 8px
  xs: 4px
  sm: 12px
  md: 24px
  lg: 48px
  xl: 80px
  gutter: 24px
  margin: 64px
---

## Brand & Style

This design system is built upon the aesthetic of **Gothic Minimalism** and **Dark Fantasy**. It is designed to evoke a sense of ancient mystery, high-stakes cinematic tension, and tactile weight. The target experience is immersive and atmospheric, prioritizing a "diegetic" feel where the music player exists as an artifact within a dark, weathered world.

The visual style leverages **Tactile Skeuomorphism** blended with high-contrast cinematic lighting. Elements should feel forged, carved, or cast. The presence of volumetric light, floating dust particles, and shifting smoke layers creates a 4K "living" interface that feels grounded in a physical space similar to the menus of *Elden Ring* or *Dark Souls*.

## Colors

The palette is rooted in the "Abyssal Neutral" of Dark Weathered Steel (#1A1A1A) and Hammered Iron (#2E2E2E). These deep, desaturated tones provide the structural foundation for the interface.

**Tarnished Gold (#B8860B)** serves as the primary accent, used for thin, elegant borders, active states, and ornate filigree. It represents "the old world"—faded glory and craftsmanship.

**Ember Orange (#FF4500)** is the functional highlight, reserved for high-action states, glowing progress indicators, and "active sparks." It provides the heat and life within the cold steel framework. Use this color with an outer glow (bloom) effect to simulate light emission.

## Typography

This design system utilizes **Noto Serif** for headlines to mimic the elegant, authoritative presence of Cinzel. Headlines should be sparsely used, often centered, and treated with significant letter spacing to evoke a sense of ancient inscriptions.

**Newsreader** serves as the primary body and label font. Its literary, traditional serif structure ensures legibility while maintaining the dark fantasy aesthetic. Labels must always use wide tracking (letter-spacing) and uppercase styling to resemble runes or etched captions on a metal plate.

## Layout & Spacing

The layout follows a **Fixed Grid** model with generous margins to create a cinematic "letterbox" feel. Content is centered within the viewport, surrounded by a heavy atmospheric vignette.

Spacing is expansive. The design system rejects density in favor of "sacred space," allowing textures and lighting effects to breathe. Use the `xl` (80px) spacing for major section breaks to emphasize the weight of each individual element.

## Elevation & Depth

Hierarchy is achieved through **Tonal Layers** and **Volumetric Lighting** rather than standard drop shadows.

1.  **The Void (Background):** Solid #1A1A1A with a subtle noise/dust overlay and a heavy radial vignette.
2.  **The Plate (Mid-ground):** Hammered Iron (#2E2E2E) panels with 1px gold bevels. These represent the primary interaction surfaces.
3.  **The Incandescence (Foreground):** Elements like the active play button or progress bar emit a "bloom" effect (Ember Orange glow), casting soft, colored light onto the surrounding iron textures.
4.  **Atmospherics:** A separate layer of semi-transparent smoke or dust particles should drift between the mid-ground and foreground to provide a sense of 3D depth.

## Shapes

The shape language is strictly **Sharp (0px)**. Rounded corners are avoided to maintain the harsh, forged nature of the interface. 

Where circular elements are required (such as "wax seal" buttons), they should be perfectly circular, but nested within sharp rectangular containers or framed by thin, ornate metal borders. Any "softness" in the UI comes from light glows and smoke, never from the geometry of the components.

## Components

### Buttons
Buttons are styled as **Wax Seals** or **Etched Runes**.
- **Primary:** A circular seal in Ember Orange with a stamped icon in the center. It should have a subtle 3D emboss.
- **Secondary:** Text-only, using the `label-sm` typography with a thin gold underline that fades out at the edges.

### Progress Bar (The Filament)
The progress bar is a "Liquid Gold Filament." The unfilled track is a faint, etched groove in the iron background. The filled portion is a glowing #FF4500 line that leaves a trailing "ember smoke" effect at its leading edge.

### Cards
Cards are "Iron Plates." They feature a #2E2E2E background with a leather-like texture overlay. Borders are extremely thin (0.5pt to 1pt) in Tarnished Gold, often featuring ornate "corner caps" or small rune-like engravings in the corners.

### Lists
Track lists are separated by thin horizontal lines that resemble "sword cuts"—a 1px line that is bright in the center and tapers into transparency at the margins.

### Interaction States
- **Hover:** A soft volumetric light follows the cursor, illuminating the metal texture beneath.
- **Active:** A brief "spark" animation (orange particles) triggers when a button is pressed.
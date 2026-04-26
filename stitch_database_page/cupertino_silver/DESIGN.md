# Design System Strategy: The Digital Curator

## 1. Overview & Creative North Star
The creative North Star for this design system is **"The Digital Curator."** 

Moving beyond mere minimalism, this system treats every interface as a high-end editorial gallery. It is characterized by an uncompromising commitment to negative space, intentional asymmetry, and a "quiet" confidence. We reject the cluttered, box-heavy layouts of traditional SaaS in favor of a fluid, cinematic experience. By utilizing dramatic scale shifts in typography and a sophisticated layering of monochromatic surfaces, we create a rhythm that guides the user’s eye with the same intentionality as a physical luxury flagship store.

## 2. Color & Tonal Depth
Our palette is a study in nuance. We move away from flat hex codes and toward an atmospheric use of light and shadow.

### The Foundation
- **Surface Strategy:** We rely on the `surface` (`#fcf8fb`) and `background` (`#fcf8fb`) as our primary canvas. 
- **The "No-Line" Rule:** 1px solid borders are strictly prohibited for defining sections. Structural separation is achieved exclusively through background shifts. Use `surface_container_low` (`#f6f3f5`) to set apart large content blocks from the main `surface`.
- **Surface Hierarchy & Nesting:** Treat the UI as physical layers. 
    - Base: `surface`
    - Section: `surface_container_low`
    - Card/Interaction Layer: `surface_container_lowest` (`#ffffff`) 
    This creates a subtle "lift" that feels organic rather than engineered.

### Signature Accents
- **The "Glass & Gradient" Rule:** Floating elements (like navigation bars or hovering action cards) must utilize Glassmorphism. Apply a backdrop blur (20px+) to semi-transparent versions of `surface_container_lowest`.
- **Primary CTA Soul:** To avoid the "flat" look, CTAs using `primary` (`#0058bc`) should implement a subtle linear gradient transitioning into `primary_container` (`#0070eb`) at a 15-degree angle. This provides a tactile, premium depth.

## 3. Typography
Typography is the voice of this design system. It is bold, authoritative, and spacious.

- **Display Scale (`display-lg` to `display-sm`):** Reserved for hero moments. Use these large sizes to anchor a page. The tight tracking and generous leading create an editorial feel that commands attention.
- **Headline & Title Scale:** These act as the "navigational markers." They should always be paired with significant vertical whitespace (`spacing-xl` or greater) to allow the "Digital Curator" ethos to breathe.
- **Body & Label:** Using the `inter` family (as a robust web alternative to SF Pro), body text is kept clean and legible at `1rem`. Labels use the `on_surface_variant` (`#414755`) to create a clear visual hierarchy between primary content and metadata.

## 4. Elevation & Depth
In this design system, depth is felt, not seen. We favor **Tonal Layering** over heavy ornamentation.

- **The Layering Principle:** Instead of using shadows for everything, use the `surface_container` tiers. A `surface_container_highest` element placed on a `surface` background creates immediate focal priority through contrast alone.
- **Ambient Shadows:** When a physical floating effect is required, use "Ambient Shadows." 
    - **Blur:** 40px - 60px
    - **Opacity:** 4% - 6%
    - **Color:** A tinted version of `on_surface` (`#1b1b1d`). 
    This mimics how light behaves on a gallery wall, avoiding the "muddy" look of standard drop shadows.
- **The "Ghost Border":** For elements that require accessibility containment (like input fields on a white background), use a 1px stroke of `outline_variant` at **15% opacity**. It should be barely perceptible—a "whisper" of a boundary.

## 5. Components

### Buttons
- **Primary:** High-gloss `primary` gradient with `on_primary` text. Roundedness: `full` for a friendly, modern feel.
- **Secondary:** `surface_container_highest` background with `on_surface` text. No border.
- **Tertiary:** Text-only with an icon, using `primary` color. Highlight on hover with a 5% opacity `primary` background circular shape.

### Input Fields
- **Styling:** Use `surface_container_low` as the field background. Forgo the bottom line or full border. Use a "Ghost Border" that transitions to `primary` (2px) only on focus.
- **Labeling:** Floating labels that shrink and move to `label-sm` on focus, ensuring the layout remains compact.

### Cards & Collections
- **Rules of Separation:** Dividers and lines are strictly forbidden. 
- **Content Spacing:** Separate card elements using `spacing-md` (0.75rem). Separate cards within a grid using `spacing-xl` (1.5rem). 
- **Interaction:** On hover, a card should not grow in size; instead, increase the "Ambient Shadow" spread and slightly shift the background from `surface_container_lowest` to a pure `#ffffff`.

### Chips
- **Action Chips:** Low-profile `secondary_container` with a `sm` (0.25rem) radius to differentiate them from the fully rounded buttons.

## 6. Do's and Don'ts

### Do
*   **DO** use extreme vertical whitespace. If a section feels "finished," add 24px more space.
*   **DO** use high-quality, desaturated imagery that complements the neutral palette.
*   **DO** use "surface-on-surface" layering to create depth.
*   **DO** ensure all transitions are eased (e.g., `cubic-bezier(0.4, 0, 0.2, 1)`) to maintain the premium feel.

### Don't
*   **DON'T** use 100% black (`#000000`). Use `on_background` (`#1b1b1d`) for better visual comfort.
*   **DON'T** use 1px solid borders to separate sections or list items. Use tonal shifts or whitespace.
*   **DON'T** use standard "drop shadows" with high opacity or small blurs.
*   **DON'T** clutter the viewport. If a feature isn't essential to the user's current task, hide it behind a progressive disclosure pattern.
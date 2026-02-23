---
name: ui_ux_polisher
description: Enforces high-quality UI/UX standards, animation recommendations, and responsive checks.
---

# UI/UX Polisher

This skill acts as your design partner, focusing on "Wow" factors, micro-interactions, and responsiveness.

## Checklist for UI Tasks

When the user asks to "make it look better" or "fix the design":

1.  **Interaction Feedback**:
    -   Ensure all buttons and interactive cards have `:hover` and `:active` states.
    -   Use `transform: scale(1.02)` or `translateY(-2px)` for subtle lift effects.
    -   Add `transition: all 0.2s ease` to smooth out changes.

2.  **Modal & Overlay Best Practices**:
    -   **Scroll Locking**: When a modal is open, **ALWAYS** prevent the body from scrolling (`overflow: hidden` on body). 
    -   **Click Outside to Close**: Ensure clicking the backdrop closes the modal, unless it's a critical task.
    -   **Focus Trap**: Ensure keyboard focus stays within the modal while it is active.
    -   **Escape to Close**: Always bind the `Esc` key to close active overlays.

3.  **Visual Hierarchy & Reading Order**:
    -   **F-Pattern/Z-Pattern**: Ensure the most important info is where the eye lands first.
    -   **Predictability**: Elements should be where users expect them (e.g., Save button at bottom right of a form).
    -   Check contrast ratios and typography scale to guide the user's eye.

3.  **Logical Flow & Intuition**:
    -   **Step-by-Step**: For complex tasks, use wizards or clear visual cues (1, 2, 3).
    -   **Context Awareness**: If a user does Action A, Action B should be the most obvious next step.
    -   **Zero State**: Design for when there's no data yet (don't show a blank white page).

4.  **Motion & Animation**:
    -   Suggest using `framer-motion` if the stack allows, or CSS Keyframes for simple fades.
    -   **Loading States**: Never leave a user staring at a blank screen. Suggest Skeleton loaders or Spinners.

5.  **Proactive Responsive Audit (Mandatory)**:
    -   **Zero-Reminder Policy**: Never submit code that only works on one screen size.
    -   **Desktop vs Mobile Report**: After implementing a UI change, briefly state: "Tested on Desktop (1440px) and Mobile (375px). Behavior: [e.g., Grids collapse to single column, Menu becomes Hamburger]."
    -   **Fluidity**: Prefer `clamp()`, `rem/vh/vw` units, and `flex-wrap` over hardcoded pixel widths.
    -   **Touch & Tap**: Ensure tap targets are at least 44px and affordances (like swipeable carousels) are considered for touch users.

## The "Premium" Look
-   **Intuitive Feedback**: Use color (Red/Green) or icons to confirm logic (Success/Error).
-   Avoid pure black (`#000000`). Use Dark Grays (`#1a1a1a`) or Navy Blues.
-   Use slightly desaturated colors for backgrounds to let content pop.

## Frontend Aesthetics — Anti-AI-Slop

AI-generated frontends tend to converge toward generic, "on distribution" outputs — the so-called **"AI slop" aesthetic**. This section enforces creative, distinctive design that surprises and delights.

### Typography
-   Choose fonts that are **beautiful, unique, and interesting**.
-   **Avoid generic fonts** like Arial, Inter, Roboto, and system fonts.
-   Opt for distinctive choices that elevate the frontend's aesthetics (e.g., from Google Fonts: Outfit, Syne, Instrument Serif, Space Mono, etc. — but vary between projects).

### Color & Theme
-   Commit to a **cohesive aesthetic**. Use CSS variables for consistency.
-   **Dominant colors with sharp accents** outperform timid, evenly-distributed palettes.
-   Draw from **IDE themes** and **cultural aesthetics** for inspiration.
-   Vary between light and dark themes across projects — don't always default to the same.

### Motion & Animation
-   Use animations for effects and micro-interactions.
-   Prioritize **CSS-only solutions** for HTML projects. Use Motion library for React when available.
-   Focus on **high-impact moments**: one well-orchestrated page load with staggered reveals (`animation-delay`) creates more delight than scattered micro-interactions.

### Backgrounds & Atmosphere
-   Create **atmosphere and depth** rather than defaulting to solid colors.
-   Layer CSS gradients, use geometric patterns, or add contextual effects that match the overall aesthetic.

### Explicitly Avoid These "AI Slop" Patterns
-   ❌ Overused font families (Inter, Roboto, Arial, system fonts)
-   ❌ Clichéd color schemes (particularly purple gradients on white backgrounds)
-   ❌ Predictable layouts and component patterns
-   ❌ Cookie-cutter design that lacks context-specific character
-   ❌ Converging on the same "safe" choices (e.g., always using Space Grotesk)

### Core Principle
> **Interpret creatively and make unexpected choices that feel genuinely designed for the context.** Think outside the box — every project should have its own distinct visual identity.

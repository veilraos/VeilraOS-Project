# VeilraOS Design Guidelines

## Design Philosophy

**Fintech-Grade Professional**: A clean, trustworthy, and modern interface that prioritizes clarity and user confidence. This is a mainnet Solana wallet handling real funds - trust and usability are paramount.

## Typography

**Font Families** (Google Fonts):
- Primary: 'Inter' (400, 500, 600, 700) - Clean, readable UI text
- Display: 'Space Grotesk' (500, 600, 700) - Modern headings with personality
- Monospace: 'JetBrains Mono' (400, 500) - Wallet addresses and numbers

**Hierarchy**:
- Page Title: Space Grotesk 700, text-2xl
- Section Headers: Space Grotesk 600, text-xl
- Body/Labels: Inter 500, text-base
- Balance Numbers: Space Grotesk 700, text-4xl
- Addresses: JetBrains Mono 400, text-sm

## Color Palette

**Light Mode**:
- Background: #f8fafc (slate-50)
- Card: #ffffff
- Text Primary: #0f172a (slate-900)
- Text Secondary: #64748b (slate-500)
- Primary: #dc2626 (red-600) - VeilraOS brand
- Primary Hover: #b91c1c (red-700)
- Accent: #0ea5e9 (sky-500)
- Success: #16a34a (green-600)
- Warning: #f59e0b (amber-500)
- Border: #e2e8f0 (slate-200)

**Dark Mode**:
- Background: #0f172a (slate-900)
- Card: #1e293b (slate-800)
- Text Primary: #f1f5f9 (slate-100)
- Text Secondary: #94a3b8 (slate-400)
- Primary: #ef4444 (red-500)
- Accent: #38bdf8 (sky-400)
- Border: #334155 (slate-700)

## Spacing

**Scale**: 4, 8, 12, 16, 24, 32, 48, 64px
- Component padding: 16-24px
- Section gaps: 24-32px
- Form field spacing: 16px

## Components

**Cards**:
- Background: white/slate-800
- Border: 1px solid slate-200/700
- Border radius: 12px
- Shadow: 0 1px 3px rgba(0,0,0,0.1)
- Padding: 24px

**Buttons**:
- Primary: solid red background, white text
- Secondary: slate background
- Ghost: transparent with hover state
- Height: 40px (default), 44px (large)
- Border radius: 8px

**Form Inputs**:
- Background: white/slate-800
- Border: 1px solid slate-300/600
- Focus ring: 2px primary color
- Border radius: 8px
- Height: 44px

**Badges**:
- Confirmed: green background, green text
- Pending: amber background, amber text
- Failed: red background, red text
- Border radius: full

## Layout

**Max Width**: 1280px (7xl)
**Grid**: Responsive 1-2 columns
**Header**: Sticky, white/dark background, subtle bottom border

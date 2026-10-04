# Community Site Integration Design

## Goal

Make the community feel like a native section of `www.breadlab.ai`, fix the blank page caused by the legacy AJAX navigation, and keep authentication controls from changing the global navigation layout.

## Root cause

The Jekyll theme intercepts all internal links and loads only `.page__content` from the destination. The standalone Vite community shell has no `.page__content`, so clicking Community removes the current content without mounting the SPA. Direct navigation works.

## Design

### Navigation boundary

The `Community` menu item is an explicit full-document navigation boundary. The existing Jekyll AJAX transition remains enabled for ordinary Jekyll pages. The generated Community link receives the theme's existing `js-no-ajax` opt-out class so the browser loads the Vite shell normally.

### Shared global shell

The community renders a React implementation of the same public shell contract as the Jekyll site:

- brand: `Ria & Seoa PaPa`;
- menu order and labels: `0 → 1`, `Blog`, `Community`, `Shop`, `About`;
- Community is visually marked as the current section;
- colors, Muli typography, content width, spacing, desktop/mobile navigation, and footer follow the existing site;
- links from the standalone SPA use normal document navigation so Jekyll pages initialize cleanly.

The community keeps its functional content and routes, but removes the separate `BREADLAB` editorial masthead treatment.

### Authentication placement

Authentication is not part of the global site menu. The global header stays identical whether the visitor is logged in or logged out.

A compact community-only action row appears below the shared header:

- logged out: `Google로 로그인` and `글쓰기`;
- logged in: a bounded profile label, `로그아웃`, and `글쓰기`;
- pending/error feedback remains accessible and does not resize the global menu;
- the profile label is shown only where community actions need account context, never as another global navigation item.

### Error handling

The existing authentication and data error states remain in-page. A failed auth check must not hide the shared header or public content. Long or hostile profile labels remain escaped by React and visually truncated.

## Acceptance criteria

1. Clicking `Community` from the production homepage performs a full navigation and renders the community heading.
2. Direct navigation to `/community/` still renders and loads public data.
3. The desktop and mobile global header has the same brand/menu structure as Jekyll pages.
4. Login state never adds a user identifier to the global menu.
5. Community login, logout, and write actions remain available in the community action row.
6. Existing community routes, drafts, OAuth return paths, and accessibility labels continue to work.
7. Build artifact verification rejects a Community menu link that lacks the AJAX opt-out contract.

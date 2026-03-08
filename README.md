# **Envisiage**

Envisiage is an inline code tutor that runs in the browser. You select code in the built-in Monaco editor and get AI-powered explanations at different granularities—from "explain like I'm 5" to step-by-step and technical breakdowns—with optional follow-up questions. Explanations are streamed in a side panel and powered by Anthropic.

---

## **Prerequisites**

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or later)
- **npm** (v9 or later)
- **AI explanations (optional):** An Anthropic API key. Without it, the explain and follow-up endpoints will return an error when you request an explanation.

---

## **Local Development**

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/envisiage.git
   cd envisiage
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create a `.env` file** in the root directory and add your Anthropic API key (optional, for AI features):
   ```bash
   ANTHROPIC_API_KEY=your_api_key_here
   ```

4. **Start the development server:**
   ```bash
   npm run dev
   ```

5. **Open [http://localhost:5173](http://localhost:5173)** in your browser to see the application.

---

## **Available Scripts**

- `npm run dev` — Start the Vite development server
- `npm run build` — Build the application for production
- `npm run preview` — Preview the production build locally
- `npm run check` — Run Svelte and TypeScript checks
- `npm run check:watch` — Run checks in watch mode

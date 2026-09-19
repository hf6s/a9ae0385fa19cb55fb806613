import SuggestBox from "@/components/SuggestBox";

export const metadata = { title: "Suggest — Factor20" };

/**
 * The suggestion box on its own page.
 *
 * It lived at the bottom of the rankings, below 136 rows of table, where
 * nobody found it. A box for feedback that requires scrolling past the entire
 * product to reach is a box that collects nothing.
 */
export default function SuggestPage() {
  return (
    <main>
      <h1 style={{ fontSize: 22, marginBottom: 6 }}>Suggest something</h1>
      <p className="meta-line">
        What is missing, wrong, or annoying? It goes straight to the dashboard.
      </p>
      <SuggestBox />
    </main>
  );
}

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { ServiceCard } from "./ServiceCard";

test("a card with an icon renders the image", () => {
  const { container } = render(
    <ServiceCard
      card={{ id: "grafana", name: "Grafana", url: "https://grafana.example.no",
              icon: "/api/instances/grafana/icon" }}
    />,
  );

  // Queried by element rather than by role: the image is decorative (`alt=""`), so it has
  // role `presentation` — the card already announces the name, and a duplicate alt would
  // make a screen reader say it twice.
  const img = container.querySelector("img");
  expect(img).toHaveAttribute("src", "/api/instances/grafana/icon");
  expect(img).toHaveAttribute("alt", "");
});

test("a card without one falls back to the glyph, not a broken image", () => {
  const { container } = render(
    <ServiceCard card={{ id: "g", name: "Grafana", url: "https://g.example.no", icon: null }} />,
  );

  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText("Grafana")).toBeInTheDocument();
});

test("a card with no URL is not a link", () => {
  render(<ServiceCard card={{ id: "g", name: "Grafana", url: null, icon: null }} />);

  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

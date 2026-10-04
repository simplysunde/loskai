import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { DeleteStackOptions } from "./DeleteStackOptions";
import type { Stack } from "./StackList";

// Recipes keep data beside the compose file, so what's worth pinning is that taking the
// data is never the default — and that the dialog says exactly what each choice does.
function Harness({ stack }: { stack: Stack }) {
  const [deleteData, setDeleteData] = useState(false);
  return (
    <>
      <DeleteStackOptions stack={stack} deleteData={deleteData} onDeleteData={setDeleteData} />
      <output>{deleteData ? "data: delete" : "data: keep"}</output>
    </>
  );
}

const WITH_DATA: Stack = { name: "bambuddy", services: ["bambuddy"], status: "up", data: ["data", "logs"] };

test("data is kept unless the box is ticked", () => {
  render(<Harness stack={WITH_DATA} />);

  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByText("data: keep")).toBeInTheDocument();
  expect(screen.getByText(/installing bambuddy again picks it back up/)).toBeInTheDocument();
});

test("the box names the folders it would take, and says it can't be undone once ticked", () => {
  render(<Harness stack={WITH_DATA} />);

  expect(screen.getByText("data/, logs/")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("checkbox"));

  expect(screen.getByText("data: delete")).toBeInTheDocument();
  expect(screen.getByText(/cannot be undone/)).toBeInTheDocument();
});

test("a stack with nothing beside its compose file offers no choice", () => {
  render(<Harness stack={{ name: "whoami", services: ["whoami"], status: "up", data: [] }} />);

  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(screen.getByText(/the folder goes too/)).toBeInTheDocument();
});

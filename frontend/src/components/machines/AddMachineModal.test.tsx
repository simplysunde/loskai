import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { AddMachineModal } from "./AddMachineModal";

function renderModal(overrides = {}) {
  const onSubmit = vi.fn();
  render(
    <AddMachineModal
      open
      baseDomain="example.no"
      onSubmit={onSubmit}
      onClose={() => {}}
      {...overrides}
    />,
  );
  return { onSubmit };
}

const submit = () => screen.getByRole("button", { name: "Name machine" });
const hostname = () => screen.getByPlaceholderText("rack1.vm3");
const address = () => screen.getByPlaceholderText("192.168.1.x");

test("a machine hostname may be dotted, and is still lowercased", () => {
  // A machine has no certificate, which is why dots are allowed here and not on a route.
  renderModal();

  fireEvent.change(hostname(), { target: { value: "rack1.VM3" } });

  expect(hostname()).toHaveValue("rack1.vm3");
  expect(screen.queryByText(/Each dot-separated label/)).not.toBeInTheDocument();
});

test("an address with a port is rejected — DNS maps names to addresses", () => {
  renderModal();

  fireEvent.change(hostname(), { target: { value: "nas" } });
  fireEvent.change(address(), { target: { value: "192.168.10.55:80" } });

  expect(screen.getByText("A bare IPv4 address — no port.")).toBeInTheDocument();
  expect(submit()).toBeDisabled();
});

test("submitting sends the machine shape — no port, no TLS, no route mode", () => {
  const { onSubmit } = renderModal();

  fireEvent.change(hostname(), { target: { value: "rack1.vm3" } });
  fireEvent.change(address(), { target: { value: "192.168.10.55" } });
  fireEvent.click(submit());

  expect(onSubmit).toHaveBeenCalledWith({
    hostname: "rack1.vm3",
    address: "192.168.10.55",
    instance_id: undefined,
  });
});

test("the form has no source picker and no HTTPS checkbox", () => {
  // Those belong to routes. Sharing one modal is what this phase undid.
  renderModal();

  expect(screen.queryByRole("button", { name: "External" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Backend speaks HTTPS/)).not.toBeInTheDocument();
  expect(screen.queryByText(/DNS-only/)).not.toBeInTheDocument();
});

test("the preview shows the name the machine will answer to", () => {
  renderModal();

  fireEvent.change(hostname(), { target: { value: "nas" } });

  expect(screen.getByText("nas.example.no")).toBeInTheDocument();
});

test("submit stays disabled until both fields are valid", () => {
  renderModal();
  expect(submit()).toBeDisabled();

  fireEvent.change(hostname(), { target: { value: "nas" } });
  expect(submit()).toBeDisabled();

  fireEvent.change(address(), { target: { value: "192.168.10.50" } });
  expect(submit()).toBeEnabled();
});

const sshUser = () => screen.getByLabelText("SSH user");

test("an SSH user puts the machine in the SSH config", () => {
  const { onSubmit } = renderModal();

  fireEvent.change(hostname(), { target: { value: "nas" } });
  fireEvent.change(address(), { target: { value: "192.168.10.50" } });
  fireEvent.change(sshUser(), { target: { value: "admin" } });
  fireEvent.click(submit());

  expect(onSubmit.mock.calls[0][0].ssh).toEqual({ user: "admin", port: 22 });
});

test("no SSH user: SSH is left out of the save", () => {
  const { onSubmit } = renderModal();

  fireEvent.change(hostname(), { target: { value: "nas" } });
  fireEvent.change(address(), { target: { value: "192.168.10.50" } });
  fireEvent.click(submit());

  expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("ssh");
});

test("a bad SSH user or port keeps the form from saving", () => {
  renderModal();

  fireEvent.change(hostname(), { target: { value: "nas" } });
  fireEvent.change(address(), { target: { value: "192.168.10.50" } });
  fireEvent.change(sshUser(), { target: { value: "-root" } });

  expect(submit()).toBeDisabled();
});


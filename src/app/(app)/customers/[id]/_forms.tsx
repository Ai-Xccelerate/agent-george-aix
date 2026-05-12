"use client";

import { useRef, useState, useTransition } from "react";
import {
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Star,
  Upload,
  UserPlus,
} from "lucide-react";
import {
  Dialog,
  DialogField,
  dialogInputClass,
  dialogTextareaClass,
} from "@/components/ui/dialog";
import {
  addContactAction,
  createEndCustomerAction,
  getCustomerDocumentDownloadUrl,
  updateCustomerAction,
  updateContactAction,
  uploadCustomerDocumentAction,
} from "../actions";

const LIFECYCLES = [
  { value: "prospect", label: "Prospect" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "at_risk", label: "At risk" },
  { value: "churned", label: "Churned" },
] as const;

// ===========================================================================
// Edit customer (basics)
// ===========================================================================
type CustomerEditValues = {
  id: string;
  name: string;
  domain: string | null;
  lifecycle: string;
  industry: string | null;
  size: string | null;
  notes: string | null;
};

export function EditCustomerButton({
  customer,
  label = "Edit",
}: {
  customer: CustomerEditValues;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSubmit] = useTransition();

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("id", customer.id);
    startSubmit(async () => {
      const res = await updateCustomerAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
      >
        <Pencil size={13} />
        {label}
      </button>

      <Dialog
        open={open}
        onClose={close}
        title="Edit customer"
        description="Quick edits to the basics. Health, contracts, plans, and contacts have their own flows."
        footer={
          <>
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-customer-form"
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              Save changes
            </button>
          </>
        }
      >
        <form id="edit-customer-form" onSubmit={onSubmit} className="space-y-4">
          <DialogField label="Name" required>
            <input
              name="name"
              required
              defaultValue={customer.name}
              autoFocus
              className={dialogInputClass}
            />
          </DialogField>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Domain">
              <input
                name="domain"
                defaultValue={customer.domain ?? ""}
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Lifecycle">
              <select
                name="lifecycle"
                defaultValue={customer.lifecycle}
                className={dialogInputClass}
              >
                {LIFECYCLES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </DialogField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Industry">
              <input
                name="industry"
                defaultValue={customer.industry ?? ""}
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Size">
              <input
                name="size"
                defaultValue={customer.size ?? ""}
                className={dialogInputClass}
              />
            </DialogField>
          </div>
          <DialogField label="Notes">
            <textarea
              name="notes"
              defaultValue={customer.notes ?? ""}
              rows={3}
              className={dialogTextareaClass}
            />
          </DialogField>
          {error && (
            <div className="rounded-md border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[13px] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}

// ===========================================================================
// Add contact
// ===========================================================================
export function AddContactButton({
  customerId,
  hasPrimary,
}: {
  customerId: string;
  hasPrimary: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSubmit] = useTransition();

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("customer_id", customerId);
    startSubmit(async () => {
      const res = await addContactAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]"
      >
        <UserPlus size={14} />
        Add contact
      </button>

      <Dialog
        open={open}
        onClose={close}
        title="Add contact"
        footer={
          <>
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-contact-form"
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              Add contact
            </button>
          </>
        }
      >
        <form id="add-contact-form" onSubmit={onSubmit} className="space-y-4">
          <DialogField label="Full name" required>
            <input
              name="full_name"
              required
              autoFocus
              placeholder="Jane Doe"
              className={dialogInputClass}
            />
          </DialogField>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Title">
              <input
                name="title"
                placeholder="VP Operations"
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Timezone">
              <input
                name="timezone"
                placeholder="America/New_York"
                className={dialogInputClass}
              />
            </DialogField>
          </div>
          <DialogField label="Email">
            <input
              name="email"
              type="email"
              placeholder="jane@example.com"
              className={dialogInputClass}
            />
          </DialogField>
          <DialogField label="Phone">
            <input
              name="phone"
              placeholder="+1 555-0100"
              className={dialogInputClass}
            />
          </DialogField>
          <label className="flex items-start gap-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 text-sm">
            <input
              type="checkbox"
              name="is_primary"
              className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
            />
            <div>
              <div className="font-medium text-[var(--color-fg)]">
                Primary contact
              </div>
              <div className="text-[12px] text-[var(--color-fg-secondary)]">
                {hasPrimary
                  ? "Will replace the current primary contact."
                  : "There's no primary yet — recommend marking one."}
              </div>
            </div>
          </label>
          {error && (
            <div className="rounded-md border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[13px] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}

// ===========================================================================
// Edit contact (inline pencil button on each contact card)
// ===========================================================================
type ContactEditValues = {
  id: string;
  full_name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  timezone: string | null;
  is_primary: boolean;
};

export function EditContactButton({ contact }: { contact: ContactEditValues }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSubmit] = useTransition();

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("id", contact.id);
    startSubmit(async () => {
      const res = await updateContactAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit contact"
        className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
      >
        <Pencil size={12} />
      </button>

      <Dialog
        open={open}
        onClose={close}
        title="Edit contact"
        footer={
          <>
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-contact-form"
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              Save changes
            </button>
          </>
        }
      >
        <form id="edit-contact-form" onSubmit={onSubmit} className="space-y-4">
          <DialogField label="Full name" required>
            <input
              name="full_name"
              required
              defaultValue={contact.full_name}
              autoFocus
              className={dialogInputClass}
            />
          </DialogField>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Title">
              <input
                name="title"
                defaultValue={contact.title ?? ""}
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Timezone">
              <input
                name="timezone"
                defaultValue={contact.timezone ?? ""}
                className={dialogInputClass}
              />
            </DialogField>
          </div>
          <DialogField label="Email">
            <input
              name="email"
              type="email"
              defaultValue={contact.email ?? ""}
              className={dialogInputClass}
            />
          </DialogField>
          <DialogField label="Phone">
            <input
              name="phone"
              defaultValue={contact.phone ?? ""}
              className={dialogInputClass}
            />
          </DialogField>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_primary"
              defaultChecked={contact.is_primary}
              className="h-4 w-4 accent-[var(--color-accent)]"
            />
            <span className="flex items-center gap-1.5 text-[var(--color-fg)]">
              <Star size={11} className="text-[var(--color-accent)]" />
              Primary contact
            </span>
          </label>
          {error && (
            <div className="rounded-md border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[13px] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}

// ===========================================================================
// Add end customer (partner-only)
// ===========================================================================
export function AddEndCustomerButton({
  parentId,
  parentName,
}: {
  parentId: string;
  parentName: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSubmit] = useTransition();

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }
  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("parent_customer_id", parentId);
    startSubmit(async () => {
      const res = await createEndCustomerAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]"
      >
        <Plus size={14} />
        Add end customer
      </button>

      <Dialog
        open={open}
        onClose={close}
        title="Add end customer"
        description={`Onboarded by ${parentName} under their partner agreement.`}
        footer={
          <>
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-end-customer-form"
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              Add end customer
            </button>
          </>
        }
      >
        <form id="add-end-customer-form" onSubmit={onSubmit} className="space-y-4">
          <DialogField label="Name" required>
            <input
              name="name"
              required
              autoFocus
              placeholder="e.g. Northwind Logistics"
              className={dialogInputClass}
            />
          </DialogField>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Domain">
              <input
                name="domain"
                placeholder="northwind.com"
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Lifecycle">
              <select
                name="lifecycle"
                defaultValue="onboarding"
                className={dialogInputClass}
              >
                {LIFECYCLES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </DialogField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Industry">
              <input
                name="industry"
                placeholder="Logistics"
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Size">
              <input
                name="size"
                placeholder="51-200"
                className={dialogInputClass}
              />
            </DialogField>
          </div>
          <DialogField label="Notes">
            <textarea
              name="notes"
              rows={3}
              className={dialogTextareaClass}
            />
          </DialogField>
          {error && (
            <div className="rounded-md border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[13px] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}

// ===========================================================================
// Document upload + list + download
// ===========================================================================
export function UploadDocumentButton({ customerId }: { customerId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, startUpload] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (pending) return;
    setError(null);
    inputRef.current?.click();
  }

  function onPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const fd = new FormData();
    fd.set("customer_id", customerId);
    fd.set("file", file);
    startUpload(async () => {
      const res = await uploadCustomerDocumentAction(fd);
      if (!res.ok) setError(res.error);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60"
      >
        {pending ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <Upload size={14} />
        )}
        {pending ? "Uploading…" : "Upload document"}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain,text/csv,text/markdown"
        onChange={onPicked}
      />
      {error && (
        <div className="mt-2 w-full rounded-md border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[12px] text-[var(--color-error)]">
          {error}
        </div>
      )}
    </>
  );
}

export type DocumentListItem = {
  id: string;
  original_name: string;
  mime_type: string;
  file_size: number;
  created_at: string;
  uploader_name: string | null;
};

export function DocumentList({ docs }: { docs: DocumentListItem[] }) {
  return (
    <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
      {docs.map((d) => (
        <DocumentRow key={d.id} doc={d} />
      ))}
    </ul>
  );
}

function DocumentRow({ doc }: { doc: DocumentListItem }) {
  const [opening, setOpening] = useState(false);
  const Icon = doc.mime_type.startsWith("image/") ? ImageIcon : FileText;

  async function open() {
    if (opening) return;
    setOpening(true);
    try {
      const res = await getCustomerDocumentDownloadUrl(doc.id);
      if (res.ok) {
        window.open(res.url, "_blank", "noopener,noreferrer");
      } else {
        alert(`Could not open file: ${res.error}`);
      }
    } finally {
      setOpening(false);
    }
  }

  return (
    <li className="flex items-center gap-3 px-4 py-3 text-[13px]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--color-accent-light)] text-[var(--color-accent)]">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-[var(--color-fg)]">
          {doc.original_name}
        </div>
        <div className="text-[11px] text-[var(--color-fg-muted)]">
          {prettyBytes(doc.file_size)} · {doc.mime_type}
          {doc.uploader_name ? ` · ${doc.uploader_name}` : ""}
          {" · "}
          {relative(doc.created_at)}
        </div>
      </div>
      <button
        type="button"
        onClick={open}
        disabled={opening}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-2.5 text-[12px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
      >
        {opening ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <Download size={12} />
        )}
        Download
      </button>
    </li>
  );
}

function prettyBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function relative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

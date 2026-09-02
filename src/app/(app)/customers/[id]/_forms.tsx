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
        className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90"
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
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-customer-form"
              disabled={pending}
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-50"
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
            <div className="rounded-md border border-error-500/40 bg-error-500/10 px-3 py-2 text-theme-sm text-error-500">
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
        className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
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
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-contact-form"
              disabled={pending}
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-50"
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
          {/*
            Role, not title. `title` is free text ("VP Ops", "Head of IT") and
            George will not choose a recipient by reading it — inferring a role
            from prose is what assembled a recipient list from a transcript on
            2026-08-20. A contact with no role is never written to unprompted.
          */}
          <DialogField label="Role on this account">
            <select name="role" defaultValue="" className={dialogInputClass}>
              <option value="">Not set — George will not write to them</option>
              <option value="champion">Champion</option>
              <option value="project_manager">Project manager</option>
              <option value="technical_lead">Technical lead</option>
              <option value="executive_sponsor">Executive sponsor</option>
              <option value="economic_buyer">Economic buyer</option>
              <option value="end_user">End user</option>
              <option value="billing">Billing</option>
              <option value="other">Other</option>
            </select>
          </DialogField>
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
          <label className="flex items-start gap-2 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 text-sm">
            <input
              type="checkbox"
              name="is_primary"
              className="mt-0.5 h-4 w-4 accent-brand-500"
            />
            <div>
              <div className="font-medium text-gray-800 dark:text-white/90">
                Primary contact
              </div>
              <div className="text-theme-xs text-gray-500 dark:text-gray-400">
                {hasPrimary
                  ? "Will replace the current primary contact."
                  : "There's no primary yet — recommend marking one."}
              </div>
            </div>
          </label>
          {error && (
            <div className="rounded-md border border-error-500/40 bg-error-500/10 px-3 py-2 text-theme-sm text-error-500">
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
  role: string | null;
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
        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:text-gray-800 dark:hover:text-white/90"
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
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="edit-contact-form"
              disabled={pending}
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-50"
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
          {/* See the note on the add-contact form: role, not title. */}
          <DialogField label="Role on this account">
            <select
              name="role"
              defaultValue={contact.role ?? ""}
              className={dialogInputClass}
            >
              <option value="">Not set — George will not write to them</option>
              <option value="champion">Champion</option>
              <option value="project_manager">Project manager</option>
              <option value="technical_lead">Technical lead</option>
              <option value="executive_sponsor">Executive sponsor</option>
              <option value="economic_buyer">Economic buyer</option>
              <option value="end_user">End user</option>
              <option value="billing">Billing</option>
              <option value="other">Other</option>
            </select>
          </DialogField>
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
              className="h-4 w-4 accent-brand-500"
            />
            <span className="flex items-center gap-1.5 text-gray-800 dark:text-white/90">
              <Star size={11} className="text-brand-500 dark:text-brand-400" />
              Primary contact
            </span>
          </label>
          {error && (
            <div className="rounded-md border border-error-500/40 bg-error-500/10 px-3 py-2 text-theme-sm text-error-500">
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
        className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
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
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-end-customer-form"
              disabled={pending}
              className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-50"
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
            <div className="rounded-md border border-error-500/40 bg-error-500/10 px-3 py-2 text-theme-sm text-error-500">
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
        // Secondary: a section-level utility, not the page's main action.
        className="h-9 px-3 inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-white/[0.03] text-theme-sm font-medium text-gray-700 dark:text-gray-200 transition hover:border-brand-500/40 hover:text-brand-500 dark:hover:text-brand-400 disabled:opacity-60"
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
        <div className="mt-2 w-full rounded-md border border-error-500/40 bg-error-500/10 px-3 py-2 text-theme-xs text-error-500">
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
    <ul className="divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
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
    <li className="flex items-center gap-3 px-4 py-3 text-theme-sm">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
        <Icon size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-gray-800 dark:text-white/90">
          {doc.original_name}
        </div>
        <div className="text-theme-xs text-gray-400 dark:text-gray-500">
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
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2.5 text-theme-xs font-medium text-gray-800 dark:text-white/90 hover:bg-gray-50 dark:hover:bg-white/[0.03] disabled:opacity-60"
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

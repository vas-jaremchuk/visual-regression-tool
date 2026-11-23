import { redirect } from 'next/navigation';

/** `/admin` has no page of its own; the breadcrumb links here, so send it to Users. */
export default function AdminIndexPage() {
  redirect('/admin/users');
}

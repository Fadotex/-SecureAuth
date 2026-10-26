import { Link } from 'react-router-dom';

function PageBackLink({ to, children }) {
  return (
    <Link className="button button-secondary page-back" to={to}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m15 18-6-6 6-6" />
        <path d="M9 12h12" />
      </svg>
      <span>{children}</span>
    </Link>
  );
}

export default PageBackLink;

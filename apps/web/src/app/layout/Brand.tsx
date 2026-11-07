import styles from './Brand.module.scss';

export function Brand() {
  return (
    <span className={styles.logo} aria-hidden="true">
      <svg className={styles.symbol} viewBox="0 0 32 32" fill="none" focusable="false">
        <path
          d="M8 3h11l7 7v18H8zM19 3v8h7"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M12 19h10m-4-4 4 4-4 4"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <span className={styles.wordmark}>
        <span className={styles.name}>Flux</span>
        <span className={styles.descriptor}>Converter</span>
      </span>
    </span>
  );
}

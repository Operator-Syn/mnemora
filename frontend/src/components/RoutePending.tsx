/**
 * Shown while a route's loader is fetching the index.
 *
 * The rule here is that a skeleton may only ever describe a real wait: the label says what is
 * actually happening, and every block below it is empty structure rather than invented content.
 * No shimmer — a shimmer over data that has not arrived is decoration pretending to be progress.
 */
export default function RoutePending() {
  return (
    <main className="pending" aria-busy="true" aria-live="polite">
      <div className="page-wrap">
        <p className="pending-status">
          <span className="pending-mark" aria-hidden="true" />
          Reading the index
        </p>

        <div className="pending-rail" aria-hidden="true">
          <i />
        </div>

        <div className="pending-title" aria-hidden="true">
          <i style={{ width: '38%' }} />
          <i style={{ width: '62%' }} />
        </div>

        <div className="pending-lede" aria-hidden="true">
          <i style={{ width: '72%' }} />
          <i style={{ width: '54%' }} />
        </div>

        <div className="pending-grid" aria-hidden="true">
          {[0, 1, 2, 3].map((slot) => (
            <div className="pending-card" key={slot}>
              <i style={{ width: `${60 - slot * 6}%` }} />
              <i style={{ width: '90%' }} />
              <i style={{ width: '76%' }} />
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}

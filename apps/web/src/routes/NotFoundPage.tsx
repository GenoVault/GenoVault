import { Link, useLocation } from 'react-router-dom'
import { EmptyState } from '@/components/StateBlocks'
import { Button } from '@/components/ui/button'

const NotFoundPage = () => {
  const { pathname } = useLocation()
  return (
    <EmptyState
      title="No such screen"
      body={`Nothing is routed at ${pathname}. The prototype has five screens: the catalog, a dataset card, dataset registration, a run, and the balance.`}
      action={
        <Button variant="outline" asChild>
          <Link to="/datasets">Open the catalog</Link>
        </Button>
      }
    />
  )
}

export default NotFoundPage

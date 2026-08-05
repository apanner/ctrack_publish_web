package queue

// Job mirrors the SQLite jobs table used by the Node engine during migration.
type Job struct {
	ID              string `json:"id"`
	FilePath        string `json:"file_path"`
	Status          string `json:"status"`
	Progress        int    `json:"progress"`
	Error           string `json:"error,omitempty"`
	ProjectID       string `json:"project_id,omitempty"`
	ShotID          string `json:"shot_id,omitempty"`
	ShotCode        string `json:"shot_code,omitempty"`
	TaskID          string `json:"task_id,omitempty"`
	TaskName        string `json:"task_name,omitempty"`
	TrackingNumber  string `json:"tracking_number,omitempty"`
	Meta            string `json:"meta,omitempty"`
	CreatedAt       string `json:"created_at"`
}

// Store is the Go-native queue interface (ported incrementally from queue-manager.ts).
type Store interface {
	AddJob(job Job) error
	UpdateJob(id string, updates map[string]any) error
	GetJob(id string) (*Job, error)
	ListJobs(limit int) ([]Job, error)
}
